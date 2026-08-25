#!/usr/bin/env python3
"""
Extracts real businesses from the Overture Maps open places dataset.

Overture publishes ~61M businesses worldwide as GeoParquet on public S3 under
CDLA Permissive v2.0 — free, commercial use allowed, and (unlike Google Places)
we are permitted to keep what we read. That last point is why this is the
system of record and Google is only ever a gap-filler.

This script does extraction ONLY. It emits newline-delimited JSON and knows
nothing about leads, scoring or the database — `scripts/import-overture.ts`
owns all of that. Keeping the two apart means the expensive, slow, network-bound
half can be re-run or cached independently of the fast half that shapes product
data, and the product logic stays testable against a fixture file.

    python3 scripts/fetch-overture.py --state FL --out data/overture-fl.ndjson

Why it reads remote parquet rather than downloading it: the places theme is
~10GB across 16 files. The files are spatially sorted and carry per-row-group
bounding boxes, so a state-sized bounding box touches roughly a fifth of them.
Reading only those row groups over HTTP range requests turns a 10GB download
into a few hundred MB.

Requires: pyarrow, fsspec (pip install pyarrow fsspec aiohttp).
"""

import argparse
import json
import urllib.parse
import sys
import time

BUCKET = "https://overturemaps-us-west-2.s3.amazonaws.com"
PREFIX = "release"

# Only the columns we actually use. Parquet is columnar, so naming them keeps
# the transfer to a fraction of the row.
COLUMNS = [
    "id", "names", "categories", "addresses", "websites", "phones",
    "socials", "emails", "confidence", "operating_status", "bbox",
]

# Rough bounding boxes per state: (min_lon, max_lon, min_lat, max_lat).
# Deliberately generous — the box only prunes row groups, and the precise
# filter is the state code on the address itself. A box that is slightly too
# big costs a little bandwidth; one that is too small silently loses
# businesses, which is the far worse failure.
STATE_BOXES = {
    "FL": (-87.8, -79.8, 24.3, 31.2),
    "GA": (-85.7, -80.7, 30.3, 35.1),
    "TX": (-106.7, -93.4, 25.8, 36.6),
    "CA": (-124.5, -114.0, 32.5, 42.1),
    "NY": (-79.8, -71.8, 40.4, 45.1),
    "NC": (-84.4, -75.4, 33.7, 36.6),
    "AZ": (-114.9, -109.0, 31.3, 37.1),
    "IL": (-91.6, -87.4, 36.9, 42.6),
    "PA": (-80.6, -74.6, 39.6, 42.4),
    "OH": (-84.9, -80.4, 38.3, 42.4),
    "NJ": (-75.6, -73.8, 38.9, 41.4),
    "WA": (-124.9, -116.9, 45.5, 49.1),
    "MA": (-73.6, -69.8, 41.1, 42.9),
    "TN": (-90.4, -81.6, 34.9, 36.7),
    "CO": (-109.1, -102.0, 36.9, 41.1),
    "NV": (-120.1, -114.0, 35.0, 42.1),
}


def list_parquet_files(prefix):
    """
    Lists the release's parquet parts via the S3 REST API.

    fsspec's HTTP filesystem cannot do this: it expects an HTML index page and
    S3 serves XML, so `ls` raises FileNotFoundError on a path that is perfectly
    readable. Listing and reading are different problems here — reading works
    fine over plain HTTPS range requests, which is the whole point.
    """
    import urllib.request
    import xml.etree.ElementTree as ET

    url = f"{BUCKET}/?list-type=2&max-keys=1000&prefix={urllib.parse.quote(prefix)}"
    with urllib.request.urlopen(url, timeout=60) as response:
        root = ET.fromstring(response.read())
    namespace = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
    keys = [node.text for node in root.findall(".//s3:Contents/s3:Key", namespace)]
    return sorted(key.rsplit("/", 1)[-1] for key in keys if key.endswith(".parquet"))


def load_categories(path):
    """Overture category -> our industry id, from the same config the app reads."""
    with open(path) as handle:
        config = json.load(handle)
    mapping = {}
    for industry_id, categories in config["industryByOvertureCategory"].items():
        for category in categories:
            mapping[category] = industry_id
    return mapping


def first_address(record):
    addresses = record.get("addresses") or []
    return addresses[0] if addresses else {}


def clean_list(values):
    return [v for v in (values or []) if v]


def extract(state, out_path, categories_path, release, limit_per_industry):
    import fsspec
    import pyarrow.parquet as pq

    box = STATE_BOXES.get(state.upper())
    if not box:
        sys.exit(
            f"No bounding box for {state}. Add one to STATE_BOXES — see the comment "
            f"there about erring large."
        )
    category_to_industry = load_categories(categories_path)

    fs = fsspec.filesystem("https")
    prefix = f"{PREFIX}/{release}/theme=places/type=place/"
    base = f"{BUCKET}/{prefix}"
    files = list_parquet_files(prefix)
    if not files:
        sys.exit(f"No parquet files under {prefix} — check --release against the bucket listing.")
    print(f"release {release}: {len(files)} parquet files", file=sys.stderr)

    written = 0
    scanned = 0
    per_industry = {}
    started = time.time()

    with open(out_path, "w") as out:
        for file_index, key in enumerate(files, start=1):
            handle = pq.ParquetFile(fs.open(base + key))
            meta = handle.metadata
            leaves = {
                meta.row_group(0).column(i).path_in_schema: i
                for i in range(meta.row_group(0).num_columns)
            }

            wanted = []
            for group in range(meta.num_row_groups):
                rg = meta.row_group(group)
                xmin = rg.column(leaves["bbox.xmin"]).statistics
                xmax = rg.column(leaves["bbox.xmax"]).statistics
                ymin = rg.column(leaves["bbox.ymin"]).statistics
                ymax = rg.column(leaves["bbox.ymax"]).statistics
                if xmax.max < box[0] or xmin.min > box[1]:
                    continue
                if ymax.max < box[2] or ymin.min > box[3]:
                    continue
                wanted.append(group)

            print(
                f"  [{file_index}/{len(files)}] {len(wanted)}/{meta.num_row_groups} row groups "
                f"in range — {written} written so far ({time.time() - started:.0f}s)",
                file=sys.stderr,
            )

            # One row group at a time: a state-sized selection can be tens of
            # millions of rows, and reading them as a single table would hold
            # the lot in memory for no benefit.
            for group in wanted:
                table = handle.read_row_groups([group], columns=COLUMNS)
                for record in table.to_pylist():
                    scanned += 1
                    category = (record.get("categories") or {}).get("primary")
                    industry = category_to_industry.get(category)
                    if not industry:
                        continue
                    if (record.get("operating_status") or "").lower() == "closed":
                        continue
                    address = first_address(record)
                    if (address.get("region") or "").upper() != state.upper():
                        continue
                    if limit_per_industry and per_industry.get(industry, 0) >= limit_per_industry:
                        continue

                    names = record.get("names") or {}
                    if not names.get("primary"):
                        continue

                    out.write(json.dumps({
                        "overtureId": record["id"],
                        "name": names["primary"],
                        "industry": industry,
                        "overtureCategory": category,
                        "alternateCategories": clean_list(
                            (record.get("categories") or {}).get("alternate")
                        ),
                        "address": address.get("freeform") or "",
                        "city": address.get("locality") or "",
                        "state": (address.get("region") or "").upper(),
                        # Overture carries ZIP+4 sometimes; the five-digit form is
                        # what people recognise and what joins to anything else.
                        "zip": (address.get("postcode") or "").split("-")[0],
                        "websites": clean_list(record.get("websites")),
                        "phones": clean_list(record.get("phones")),
                        "socials": clean_list(record.get("socials")),
                        "emails": clean_list(record.get("emails")),
                        "confidence": record.get("confidence"),
                        "longitude": (record.get("bbox") or {}).get("xmin"),
                        "latitude": (record.get("bbox") or {}).get("ymin"),
                    }) + "\n")
                    written += 1
                    per_industry[industry] = per_industry.get(industry, 0) + 1

    print(
        f"\n{written} businesses written from {scanned} scanned "
        f"in {time.time() - started:.0f}s -> {out_path}",
        file=sys.stderr,
    )
    for industry, count in sorted(per_industry.items(), key=lambda kv: -kv[1]):
        print(f"  {count:7d}  {industry}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", required=True, help="Two-letter state code, e.g. FL")
    parser.add_argument("--out", required=True, help="Path to write NDJSON to")
    parser.add_argument("--categories", default="config/overture-categories.json")
    parser.add_argument("--release", default="2026-08-19.0")
    parser.add_argument(
        "--limit-per-industry",
        type=int,
        default=0,
        help="Stop after this many per industry. 0 means no limit.",
    )
    args = parser.parse_args()
    extract(args.state, args.out, args.categories, args.release, args.limit_per_industry)


if __name__ == "__main__":
    main()
