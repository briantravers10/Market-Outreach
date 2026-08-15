import type { PipelineStageName } from "@market-outreach/core";

const STEPS: { key: PipelineStageName; label: string }[] = [
  { key: "discovery", label: "Discovery" },
  { key: "enrichment", label: "Enrichment" },
  { key: "website_analysis", label: "Website analysis" },
  { key: "qualification", label: "Qualification" },
  { key: "deduplication", label: "Deduplication" },
];

export function PipelineChecklist({ completed }: { completed: PipelineStageName[] }) {
  return (
    <div className="pipeline-checklist">
      {STEPS.map((step) => {
        const done = completed.includes(step.key);
        return (
          <span key={step.key} className={`pipeline-step ${done ? "done" : ""}`}>
            {done ? "✓" : "•"} {step.label}
          </span>
        );
      })}
    </div>
  );
}
