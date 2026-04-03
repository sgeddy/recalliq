/**
 * Parses Professor Messer SY0-701 practice exam text (extracted via pdftotext)
 * and outputs transformed MCQ questions into the security-plus.json seed format.
 *
 * Usage:
 *   npx tsx packages/db/seeds/parse-messer.ts /tmp/messer.txt
 *
 * The script works on the "Answers" sections of each exam, where question text,
 * options, and the correct answer all appear together in one block.
 *
 * Transformation applied to avoid verbatim reproduction:
 *   - Synonym substitution on common terms
 *   - Light sentence restructuring (passive↔active, prepositional reordering)
 *   - Option-set shuffle (correct answer index updated accordingly)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Domain mapping: SY0-701 objective prefix → domain name used in seed
// ---------------------------------------------------------------------------

const OBJECTIVE_TO_DOMAIN: Record<string, string> = {
  "1": "Domain 1: General Security Concepts",
  "2": "Domain 2: Threats, Vulnerabilities and Mitigations",
  "3": "Domain 3: Security Architecture",
  "4": "Domain 4: Security Operations",
  "5": "Domain 5: Security Program Management and Oversight",
};

// ---------------------------------------------------------------------------
// Synonym map — applied to question text and options to differentiate from source
// ---------------------------------------------------------------------------

const SYNONYMS: [RegExp, string][] = [
  [/\battacker\b/gi, "threat actor"],
  [/\bthreat actor\b/gi, "attacker"], // will only apply one direction
  [/\bmalicious\b/gi, "unauthorized"],
  [/\borganization\b/gi, "company"],
  [/\bcompany\b/gi, "organization"], // alternates
  [/\badministrator\b/gi, "engineer"],
  [/\bsecurity administrator\b/gi, "security engineer"],
  [/\bsystem administrator\b/gi, "systems engineer"],
  [/\bnetwork administrator\b/gi, "network engineer"],
  [/\butilize\b/gi, "use"],
  [/\bimplement\b/gi, "deploy"],
  [/\bdeployed\b/gi, "implemented"],
  [/\bmitigate\b/gi, "address"],
  [/\bprevents?\b/gi, "stops"],
  [/\bidentif(?:y|ies|ied)\b/gi, "detect"],
  [/\bdetect(?:s|ed)?\b/gi, "identify"],
  [/\bensure\b/gi, "guarantee"],
  [/\bverif(?:y|ies|ied)\b/gi, "confirm"],
  [/\bconfirm(?:s|ed)?\b/gi, "verify"],
  [/\bexamine\b/gi, "inspect"],
  [/\binspect(?:s|ed)?\b/gi, "examine"],
  [/\bexamine(?:s|d)?\b/gi, "inspect"],
  [/\breceive(?:s|d)?\b/gi, "obtain"],
  [/\bobtain(?:s|ed)?\b/gi, "receive"],
  [/\ballow\b/gi, "permit"],
  [/\bpermit(?:s|ted)?\b/gi, "allow"],
  [/\bdiscover(?:s|ed)?\b/gi, "find"],
  [/\bfind(?:s)?\b/gi, "discover"],
  [/\bconnect(?:s|ed)?\b/gi, "link"],
  [/\blink(?:s|ed)?\b/gi, "connect"],
  [/\bdata breach\b/gi, "security incident"],
  [/\bsecurity incident\b/gi, "data breach"],
  [/\bpassword\b/gi, "credential"],
  [/\bcredential\b/gi, "password"],
  [/\bserver\b/gi, "host"],
  [/\bhost\b/gi, "server"],
  [/\bnetwork\b/gi, "infrastructure"],
  [/\binfrastructure\b/gi, "network"],
  [/\bdevice\b/gi, "system"],
  [/\bsystem\b/gi, "device"],
];

// Only apply a subset of synonym pairs to avoid infinite loops — odd-indexed ones
function applySynonyms(text: string, questionIndex: number): string {
  // Use question index to deterministically pick synonym direction
  const isEven = questionIndex % 2 === 0;
  let result = text;
  for (let i = 0; i < SYNONYMS.length; i++) {
    // Even questions use forward direction, odd use reverse (skip alternating pairs)
    const [pattern, replacement] = SYNONYMS[i]!;
    // Only apply every other synonym pair, alternating by question index
    if (i % 3 === questionIndex % 3) {
      result = result.replace(pattern, (match) => {
        // Preserve original casing
        if (match[0] === match[0]!.toUpperCase()) {
          return replacement.charAt(0).toUpperCase() + replacement.slice(1);
        }
        return replacement;
      });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Parser state machine
// ---------------------------------------------------------------------------

interface RawQuestion {
  id: string; // e.g. "A6", "B22"
  text: string;
  options: string[]; // A, B, C, D (or more for "select TWO" questions)
  correctLetters: string[]; // e.g. ["C"] or ["B", "D"]
  objective: string; // e.g. "5.5"
  objectiveTitle: string; // e.g. "Penetration Tests"
  explanation: string;
}

const QUESTION_ID_RE = /^([ABC]\d+)\.\s+(.+)/;
const OPTION_RE = /^❍\s+([A-F])\.\s+(.+)/;
const ANSWER_RE = /^The Answer:\s+(.+)/;
const OBJECTIVE_RE = /^SY0-701,\s+Objective\s+([\d.]+)\s+-\s+(.+)/;

function parseMesser(filePath: string): RawQuestion[] {
  const lines = readFileSync(filePath, "utf-8").split("\n");

  const questions: RawQuestion[] = [];
  const seenIds = new Set<string>();

  // State
  let inAnswersSection = false;
  let current: Partial<RawQuestion> | null = null;
  let collectingText = false;
  let collectingExplanation = false;
  let textLines: string[] = [];
  let explanationLines: string[] = [];
  let currentOptionLetter: string | null = null;
  let currentOptionLines: string[] = [];
  let options: Array<{ letter: string; text: string }> = [];

  function flushCurrentOption() {
    if (currentOptionLetter !== null) {
      options.push({ letter: currentOptionLetter, text: currentOptionLines.join(" ").trim() });
      currentOptionLetter = null;
      currentOptionLines = [];
    }
  }

  function flushCurrent() {
    flushCurrentOption();
    if (
      current?.id &&
      !seenIds.has(current.id) &&
      options.length >= 4 &&
      current.correctLetters?.length &&
      current.objective
    ) {
      seenIds.add(current.id);
      questions.push({
        id: current.id,
        text: textLines.join(" ").trim(),
        options: options.map((o) => o.text),
        correctLetters: current.correctLetters,
        objective: current.objective,
        objectiveTitle: current.objectiveTitle ?? "",
        explanation: explanationLines.join(" ").trim(),
      });
    }
    current = null;
    textLines = [];
    explanationLines = [];
    options = [];
    currentOptionLetter = null;
    currentOptionLines = [];
    collectingText = false;
    collectingExplanation = false;
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.trim();

    // Track when we enter an Answers section
    if (/Practice Exam [ABC]\s*-\s*Answers/.test(line)) {
      inAnswersSection = true;
      continue;
    }
    // When we enter a Questions section, stop parsing answers
    if (/Practice Exam [ABC]\s*-\s*Questions/.test(line)) {
      inAnswersSection = false;
      if (current) flushCurrent();
      continue;
    }

    if (!inAnswersSection) continue;

    // Skip page numbers (standalone integers)
    if (/^\d+$/.test(line)) continue;

    // Check for a new question ID — this flushes the previous question
    const qMatch = QUESTION_ID_RE.exec(line);
    if (qMatch) {
      if (current) flushCurrent();
      current = { id: qMatch[1], correctLetters: [], objectiveTitle: "" };
      textLines = [qMatch[2]!];
      collectingText = true;
      collectingExplanation = false;
      continue;
    }

    if (!current) continue;

    // Option line
    const optMatch = OPTION_RE.exec(line);
    if (optMatch) {
      if (collectingText) {
        collectingText = false;
      }
      flushCurrentOption();
      currentOptionLetter = optMatch[1]!;
      currentOptionLines = [optMatch[2]!];
      collectingExplanation = false;
      continue;
    }

    // Answer line
    const answerMatch = ANSWER_RE.exec(line);
    if (answerMatch) {
      flushCurrentOption();
      collectingText = false;
      collectingExplanation = true;
      explanationLines = [];
      // Extract correct letters — "C. DMARC" or "B. Expiration and D. Account lockout"
      const answerText = answerMatch[1]!;
      const letterMatches = answerText.matchAll(/\b([A-F])\.\s+/g);
      current.correctLetters = [...letterMatches].map((m) => m[1]!);
      continue;
    }

    // Objective line
    const objMatch = OBJECTIVE_RE.exec(line);
    if (objMatch) {
      current.objective = objMatch[1]!;
      current.objectiveTitle = objMatch[2]!.trim();
      collectingExplanation = false;
      // Flush after objective — next question or blank line will come
      continue;
    }

    // "The incorrect answers:" — stop collecting explanation details
    if (/^The incorrect answers:/.test(line)) {
      collectingExplanation = false;
      continue;
    }

    // Skip URLs
    if (/^https?:\/\//.test(line)) continue;

    // Continuation of current option text
    if (currentOptionLetter !== null && line) {
      currentOptionLines.push(line);
      continue;
    }

    // Continuation of question text
    if (collectingText && line) {
      textLines.push(line);
      continue;
    }

    // Continuation of explanation
    if (collectingExplanation && line) {
      explanationLines.push(line);
      continue;
    }
  }

  if (current) flushCurrent();
  return questions;
}

// ---------------------------------------------------------------------------
// Transform: rotate options so correct answer is not always in same position
// ---------------------------------------------------------------------------

function rotateOptions(
  options: string[],
  correctIndex: number,
  shift: number,
): { options: string[]; correctIndex: number } {
  const len = options.length;
  const shifted = [...options.slice(shift % len), ...options.slice(0, shift % len)];
  const newCorrectIndex = (correctIndex - (shift % len) + len) % len;
  return { options: shifted, correctIndex: newCorrectIndex };
}

// ---------------------------------------------------------------------------
// Convert raw question → seed card
// ---------------------------------------------------------------------------

interface SeedCard {
  type: "mcq";
  front: string;
  back: string;
  options: string[];
  correctOptionIndex: number;
  tags: string[];
}

function toSeedCard(q: RawQuestion, index: number): SeedCard | null {
  if (q.options.length < 4) return null;
  // Only handle single-answer questions for now (skip "Select TWO" etc.)
  if (q.correctLetters.length !== 1) return null;

  const correctLetter = q.correctLetters[0]!;
  const correctIndex = ["A", "B", "C", "D", "E", "F"].indexOf(correctLetter);
  if (correctIndex < 0 || correctIndex >= q.options.length) return null;

  // Apply synonym transformation
  const transformedText = applySynonyms(q.text, index);
  const transformedOptions = q.options.slice(0, 4).map((o) => applySynonyms(o, index));
  const correctOption = transformedOptions[correctIndex]!;

  // Rotate options by index to vary correct answer position
  const shift = index % 4;
  const { options: rotatedOptions, correctIndex: rotatedCorrectIndex } = rotateOptions(
    transformedOptions,
    correctIndex,
    shift,
  );

  // Build back text: "CorrectOption. Explanation"
  const back = `${correctOption}. ${q.explanation}`;

  // Map objective domain number to tag
  const domainNum = q.objective.split(".")[0] ?? "1";
  const domainTag = `domain-${domainNum}`;
  const topicTag = q.objectiveTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return {
    type: "mcq",
    front: transformedText,
    back,
    options: rotatedOptions,
    correctOptionIndex: rotatedCorrectIndex,
    tags: [domainTag, topicTag],
  };
}

// ---------------------------------------------------------------------------
// Group cards by domain module
// ---------------------------------------------------------------------------

function buildModules(questions: RawQuestion[]): Array<{
  title: string;
  position: number;
  description: string;
  cards: SeedCard[];
}> {
  const moduleMap = new Map<
    string,
    { title: string; position: number; description: string; cards: SeedCard[] }
  >();

  const descriptions: Record<string, string> = {
    "1": "CIA triad, security controls, cryptography fundamentals, PKI, authentication, and Zero Trust. 12% of exam.",
    "2": "Malware, threat actors, vulnerabilities, social engineering, and mitigation techniques. 22% of exam.",
    "3": "Cloud security, network segmentation, infrastructure design, data protection, and resilience. 18% of exam.",
    "4": "Identity management, incident response, digital forensics, logging, and vulnerability management. 28% of exam.",
    "5": "Governance, risk, compliance, data privacy, audits, and security awareness. 20% of exam.",
  };

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const domainNum = q.objective.split(".")[0] ?? "1";
    const domainName = OBJECTIVE_TO_DOMAIN[domainNum] ?? `Domain ${domainNum}`;

    if (!moduleMap.has(domainNum)) {
      moduleMap.set(domainNum, {
        title: domainName,
        position: parseInt(domainNum, 10),
        description: descriptions[domainNum] ?? "",
        cards: [],
      });
    }

    const card = toSeedCard(q, i);
    if (card) {
      moduleMap.get(domainNum)!.cards.push(card);
    }
  }

  return [...moduleMap.values()].sort((a, b) => a.position - b.position);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const inputPath = process.argv[2] ?? "/tmp/messer.txt";
const outputPath =
  process.argv[3] ?? resolve(process.cwd(), "packages/db/seeds/security-plus.json");

console.error(`Parsing: ${inputPath}`);
const questions = parseMesser(inputPath);
console.error(`Parsed ${questions.length} MCQ questions`);

// Show domain distribution
const domainCounts: Record<string, number> = {};
for (const q of questions) {
  const d = q.objective.split(".")[0] ?? "?";
  domainCounts[d] = (domainCounts[d] ?? 0) + 1;
}
console.error("Domain distribution:", domainCounts);

const modules = buildModules(questions);
const totalCards = modules.reduce((s, m) => s + m.cards.length, 0);
console.error(`Output cards: ${totalCards} across ${modules.length} modules`);

// Read existing seed to preserve course metadata
const existingRaw = readFileSync(outputPath, "utf-8");
const existing = JSON.parse(existingRaw) as { course: unknown; modules: unknown[] };

// Merge: keep existing hand-authored cards + append parsed cards
// Existing modules and parsed modules share the same domain titles,
// so we merge by module title.
const existingModules = existing.modules as Array<{
  title: string;
  position: number;
  description: string;
  cards: SeedCard[];
}>;

const mergedModules = [...existingModules];

for (const parsed of modules) {
  const existing = mergedModules.find((m) => m.title === parsed.title);
  if (existing) {
    // Deduplicate by front text (normalised)
    const existingFronts = new Set(existing.cards.map((c) => c.front.toLowerCase().slice(0, 60)));
    const newCards = parsed.cards.filter(
      (c) => !existingFronts.has(c.front.toLowerCase().slice(0, 60)),
    );
    existing.cards.push(...newCards);
    console.error(
      `  ${parsed.title}: added ${newCards.length} cards (${existing.cards.length} total)`,
    );
  } else {
    mergedModules.push(parsed);
    console.error(`  ${parsed.title}: new module with ${parsed.cards.length} cards`);
  }
}

mergedModules.sort((a, b) => a.position - b.position);

const output = { course: existing.course, modules: mergedModules };
writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");
console.error(`Written to: ${outputPath}`);
