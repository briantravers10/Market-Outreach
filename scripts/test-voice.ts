/**
 * Voice selection and the settings that drive it.
 *
 * Two properties matter more than the rest, and most of these tests are about
 * them.
 *
 * A voice must never silently be the wrong accent. The owner asked for eight
 * specific accent-and-gender combinations and said explicitly that accents must
 * not be faked. Devices differ in what they have installed, so a chosen accent
 * sometimes cannot be honoured — and the failure that matters is not the
 * substitution, it is a substitution the settings screen does not admit to.
 *
 * And settings must always be usable. They are read on every page load and fed
 * straight into the speech engine; a corrupt or hand-edited value costing the
 * owner his preferences is recoverable, one that crashes the assistant or
 * leaves it unnamed is not.
 *
 *   npm run test-voice
 */
import {
  DEFAULT_VOICE_SETTINGS,
  MAX_RATE,
  MIN_RATE,
  VOICE_PROFILES,
  describeAvailability,
  findVoiceProfile,
  greetingFor,
  parseVoiceSettings,
  resolveVoice,
  serialiseVoiceSettings,
  voiceSettingsFromForm,
  type InstalledVoice,
} from "@market-outreach/core";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

const v = (name: string, lang: string): InstalledVoice => ({ name, lang });

/** Roughly what an Apple device carries — the best case for these eight. */
const APPLE: InstalledVoice[] = [
  v("Daniel", "en-GB"),
  v("Kate", "en-GB"),
  v("Moira", "en-IE"),
  v("Samantha", "en-US"),
  v("Alex", "en-US"),
  v("Karen", "en-AU"),
  v("Lee", "en-AU"),
];

function main(): void {
  section("The eight the owner asked for");

  check("all eight profiles exist", VOICE_PROFILES.length === 8, String(VOICE_PROFILES.length));
  for (const accent of ["british", "irish", "american", "australian"] as const) {
    const both = VOICE_PROFILES.filter((p) => p.accent === accent);
    check(
      `${accent} has a female and a male voice`,
      both.length === 2 && both.some((p) => p.gender === "female") && both.some((p) => p.gender === "male")
    );
  }
  check(
    "every profile names a real accent language tag, not a general 'en'",
    VOICE_PROFILES.every((p) => p.langs.length > 0 && p.langs.every((l) => l.includes("-"))),
    "an accent asked for by tag is a real accent; 'en' would be whatever the device felt like"
  );

  section("Picking a voice on a device that has them");

  {
    const british = resolveVoice(findVoiceProfile("british-male")!, APPLE);
    check("a named voice is chosen exactly", british.quality === "exact" && british.voice?.name === "Daniel", british.explanation);

    const irish = resolveVoice(findVoiceProfile("irish-female")!, APPLE);
    check("Irish resolves to a genuinely Irish voice", irish.voice?.name === "Moira" && irish.voice?.lang === "en-IE");

    const australian = resolveVoice(findVoiceProfile("australian-male")!, APPLE);
    check("Australian resolves to an Australian voice", australian.voice?.lang === "en-AU", australian.explanation);
  }

  {
    // Vendors decorate the same voice differently across platforms.
    const decorated = [v("Microsoft Daniel - English (United Kingdom)", "en-GB")];
    const result = resolveVoice(findVoiceProfile("british-male")!, decorated);
    check("a decorated vendor name still matches", result.quality === "exact", result.explanation);
  }

  section("Picking a voice on a device that does NOT");

  {
    // The case that decides whether this feature can be trusted: an Irish voice
    // asked for on a device with none. Substituting silently would leave the
    // setting reading Irish while an American voice speaks.
    const americanOnly = [v("Samantha", "en-US"), v("Alex", "en-US")];
    const result = resolveVoice(findVoiceProfile("irish-male")!, americanOnly);
    check("a missing accent still returns something speakable", result.voice !== null);
    check("but it is marked as a fallback, not a match", result.quality === "fallback", result.quality);
    check(
      "and it says plainly that the accent is not the one chosen",
      result.explanation.includes("no irish voice") || result.explanation.toLowerCase().includes("irish"),
      result.explanation
    );
    // Alex, not Samantha: with the accent already lost, keeping the gender the
    // owner asked for is the closest thing left to what he chose.
    check("naming the voice actually being used", result.explanation.includes("Alex"), result.explanation);
    check("and preferring the right gender once the accent is gone", result.voice?.name === "Alex", String(result.voice?.name));
  }

  {
    // Right accent, unlisted voice. Genuinely that accent, so not a fallback —
    // conflating the two would under-report a perfectly good match.
    const unlisted = [v("Niamh", "en-IE")];
    const result = resolveVoice(findVoiceProfile("irish-female")!, unlisted);
    check("an unlisted voice of the right accent counts as the accent", result.quality === "accent", result.quality);
    check("and is not claimed as an exact match", result.quality !== "exact");
    check(
      "and admits the gender is not guaranteed",
      result.explanation.includes("not guaranteed"),
      "an unknown name tells us nothing about the voice's gender, and implying otherwise is the same silent substitution"
    );
  }

  {
    // The one this rule exists for. The owner asked for eight combinations, not
    // four accents: an Irish FEMALE voice is not an acceptable answer to a
    // request for an Irish male one, however right the accent is.
    const irishFemaleAndAmericanMale = [v("Moira", "en-IE"), v("Alex", "en-US")];
    const result = resolveVoice(findVoiceProfile("irish-male")!, irishFemaleAndAmericanMale);
    check(
      "a female voice is not offered as 'the right accent' for a male profile",
      result.voice?.name !== "Moira",
      `got ${result.voice?.name} — an Irish female voice is not a closer match to Irish male than an American male one`
    );
    check("the male voice is chosen instead", result.voice?.name === "Alex", String(result.voice?.name));
    check("and it is honest that the accent was lost", result.quality === "fallback", result.quality);
  }

  {
    // The genuinely cornered case: every English voice on the device is one we
    // know to be female, and a male one was asked for. Speaking in the wrong
    // voice beats saying nothing — but only because it says so. Silence would
    // look like a broken feature; an unannounced substitution would look like a
    // working one that quietly ignores the setting.
    const allFemale = [v("Moira", "en-IE"), v("Samantha", "en-US")];
    const result = resolveVoice(findVoiceProfile("irish-male")!, allFemale);
    check("it still speaks rather than falling silent", result.voice !== null);
    check("marked as a fallback", result.quality === "fallback", result.quality);
    check(
      "and it admits BOTH the accent and the tone are wrong",
      result.explanation.includes("Neither the accent nor the tone"),
      result.explanation
    );
  }

  {
    const result = resolveVoice(findVoiceProfile("british-female")!, []);
    check("no voices at all is reported, not crashed", result.voice === null && result.quality === "none");
    check("and the reason is in plain words", result.explanation.includes("no English speech voices"), result.explanation);
  }

  {
    const nonEnglish = [v("Amélie", "fr-FR"), v("Anna", "de-DE")];
    const result = resolveVoice(findVoiceProfile("american-female")!, nonEnglish);
    check(
      "a device with only non-English voices does not speak English in a French voice",
      result.quality === "none",
      result.explanation
    );
  }

  section("Which of the eight this device can actually do");

  {
    const availability = describeAvailability(APPLE);
    check("every profile is reported on", availability.length === 8);
    const exact = availability.filter((a) => a.resolution.quality === "exact").length;
    check("an Apple-like device matches most of them by name", exact >= 6, `${exact} exact`);
    const irishMale = availability.find((a) => a.profile.id === "irish-male");
    check(
      "and honestly reports the one it cannot do",
      irishMale?.resolution.quality === "fallback",
      "Irish male is the scarcest of the eight and must not be claimed when absent"
    );
  }

  section("Settings survive anything in storage");

  check("nothing stored gives working defaults", parseVoiceSettings(null).assistantName === "Manager");
  check("invalid JSON gives working defaults", parseVoiceSettings("{oh dear").rate === DEFAULT_VOICE_SETTINGS.rate);
  check("a JSON array gives working defaults", parseVoiceSettings("[1,2,3]").voiceProfileId === DEFAULT_VOICE_SETTINGS.voiceProfileId);
  check("a JSON string gives working defaults", parseVoiceSettings('"nope"').speakReplies === true);

  {
    // A voice id that no longer exists must not reach the speech engine.
    const stale = parseVoiceSettings(JSON.stringify({ voiceProfileId: "klingon-male" }));
    check("a voice id we no longer have falls back", stale.voiceProfileId === DEFAULT_VOICE_SETTINGS.voiceProfileId);
  }

  {
    const wild = parseVoiceSettings(JSON.stringify({ rate: 99 }));
    check("an absurd rate is clamped rather than obeyed", wild.rate === MAX_RATE, String(wild.rate));
    const tiny = parseVoiceSettings(JSON.stringify({ rate: -4 }));
    check("and so is a negative one", tiny.rate === MIN_RATE, String(tiny.rate));
    const nonsense = parseVoiceSettings(JSON.stringify({ rate: "quickly" }));
    check("a non-numeric rate falls back", nonsense.rate === DEFAULT_VOICE_SETTINGS.rate);
  }

  {
    const blanked = parseVoiceSettings(JSON.stringify({ assistantName: "   " }));
    check("a whitespace-only name never leaves the assistant unnamed", blanked.assistantName === "Manager");
    const multiline = parseVoiceSettings(JSON.stringify({ assistantName: "Ops\nBoss" }));
    check(
      "a newline in the name is flattened",
      multiline.assistantName === "Ops Boss",
      "it is rendered as a heading and spoken aloud; a newline is a defect in both"
    );
  }

  section("Saving from the form");

  {
    const { settings, corrections } = voiceSettingsFromForm({
      voiceProfileId: "irish-female",
      rate: "1.15",
      assistantName: "Aoife",
      greeting: "Morning. Where do you want to start?",
      speakReplies: "on",
      handsFree: "on",
    });
    check("a valid submission is kept as given", settings.voiceProfileId === "irish-female" && settings.rate === 1.15);
    check("the name is applied", settings.assistantName === "Aoife");
    check("checkboxes read as booleans", settings.speakReplies === true && settings.handsFree === true);
    check("and nothing needed correcting", corrections.length === 0, corrections.join("; "));
  }

  {
    // A form is only a suggestion — anything can post to a server action.
    const { settings, corrections } = voiceSettingsFromForm({ voiceProfileId: "made-up", rate: "9" });
    check("an unknown voice is refused rather than stored", settings.voiceProfileId === DEFAULT_VOICE_SETTINGS.voiceProfileId);
    check("an out-of-range rate is clamped", settings.rate === MAX_RATE);
    check("and both corrections are reported back", corrections.length === 2, corrections.join(" | "));
  }

  {
    const { settings } = voiceSettingsFromForm({ assistantName: "x".repeat(200) });
    check("an absurdly long name is truncated", settings.assistantName.length === 40, String(settings.assistantName.length));
  }

  {
    const { settings } = voiceSettingsFromForm({ voiceProfileId: "british-male" });
    check("unchecked boxes mean off, not missing", settings.speakReplies === false && settings.handsFree === false);
  }

  {
    const round = parseVoiceSettings(
      serialiseVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, assistantName: "Aoife", rate: 1.2, voiceProfileId: "irish-female" })
    );
    check("settings survive a save-and-read round trip", round.assistantName === "Aoife" && round.rate === 1.2 && round.voiceProfileId === "irish-female");
  }

  section("The greeting");

  check(
    "an owner who has set a greeting hears it",
    greetingFor({ ...DEFAULT_VOICE_SETTINGS, greeting: "Right, what's first?" }, true) === "Right, what's first?"
  );
  check(
    "one who never configured anything hears something rather than silence",
    greetingFor(DEFAULT_VOICE_SETTINGS, false).includes("Manager")
  );
  check(
    "and the fallback uses whatever the assistant is now called",
    greetingFor({ ...DEFAULT_VOICE_SETTINGS, assistantName: "Aoife" }, false).includes("Aoife")
  );
  check(
    "deliberately clearing the greeting is respected, not overridden",
    greetingFor({ ...DEFAULT_VOICE_SETTINGS, greeting: "" }, true) === "",
    "having chosen silence is a choice"
  );

  console.log("\n" + "=".repeat(40));
  console.log(`${passed} passed, ${failed} failed`);
  if (failures.length) console.log(`Failed: ${failures.join(", ")}`);
  console.log("=".repeat(40));
  if (failed > 0) process.exitCode = 1;
}

main();
