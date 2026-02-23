const RECEIPT_NOISE_TOKENS = new Set([
  "ea",
  "each",
  "item",
  "@",
  "w",
  "w/",
  "with",
  "add",
  "no",
  "extra",
  "mod",
  "modifier",
  "ln",
  "line",
]);

const ABBREVIATIONS: Record<string, string> = {
  chk: "chicken",
  chx: "chicken",
  chkn: "chicken",
  cf: "chicken fried",
  bff: "buffalo",
  bfl: "buffalo",
  bflo: "buffalo",
  brg: "burger",
  bg: "burger",
  bgr: "burger",
  veg: "vegetable",
  vgg: "veggie",
  vgn: "vegan",
  shmp: "shrimp",
  shrmp: "shrimp",
  shrp: "shrimp",
  fr: "fried",
  fries: "fries",
  bbq: "barbecue",
  bq: "barbecue",
  sw: "sandwich",
  snd: "sandwich",
  sando: "sandwich",
  app: "appetizer",
  ckn: "chicken",
  stk: "steak",
  tky: "turkey",
  mozz: "mozzarella",
  parm: "parmesan",
  jal: "jalapeno",
  mush: "mushroom",
  avoc: "avocado",
  guac: "guacamole",
  blt: "bacon lettuce tomato",
  qsad: "quesadilla",
  ques: "quesadilla",
  tacoz: "tacos",
  taco: "taco",
  tx: "texas",
  mex: "mexican",
  spcy: "spicy",
  reg: "regular",
  lg: "large",
  med: "medium",
  sm: "small",
  wht: "white",
  whl: "whole",
  org: "organic",
  bev: "beverage",
  drk: "drink",
  brk: "broccoli",
  mtb: "meatball",
};

const MULTI_SPACE_RE = /\s+/g;
const LEADING_QTY_RE = /^\s*(?:\(?\s*(\d{1,2})\s*\)?\s*(?:x|qty)?\.?\s*)(.+)$/i;
const PREFIX_X_QTY_RE = /^\s*x\s*(\d{1,2})\s+(.+)$/i;
const TRAILING_QTY_RE = /^\s*(.+?)\s*(?:x\s*(\d{1,2})|\((\d{1,2})\))\s*$/i;
const STARTS_WITH_QTY_TEXT_RE = /^\d+\s+[a-z]/i;

function cleanPunctuation(value: string): string {
  return value
    .replace(/[|*_~`"'.,;:!?()[\]{}<>#+=]/g, " ")
    .replace(/[\/\\-]+/g, " ")
    .replace(MULTI_SPACE_RE, " ")
    .trim();
}

export function detectQuantity(raw: string): { qty: number; cleaned: string } {
  const input = (raw ?? "").trim();
  if (!input) return { qty: 1, cleaned: "" };

  const leadingMatch = input.match(LEADING_QTY_RE);
  if (leadingMatch && STARTS_WITH_QTY_TEXT_RE.test(input)) {
    const qty = Number.parseInt(leadingMatch[1], 10);
    if (Number.isFinite(qty) && qty > 0) {
      return { qty, cleaned: leadingMatch[2].trim() };
    }
  }

  const xPrefix = input.match(PREFIX_X_QTY_RE);
  if (xPrefix) {
    const qty = Number.parseInt(xPrefix[1], 10);
    if (Number.isFinite(qty) && qty > 0) {
      return { qty, cleaned: xPrefix[2].trim() };
    }
  }

  const trailing = input.match(TRAILING_QTY_RE);
  if (trailing) {
    const qtyRaw = trailing[2] ?? trailing[3];
    const qty = Number.parseInt(qtyRaw, 10);
    if (Number.isFinite(qty) && qty > 0) {
      return { qty, cleaned: trailing[1].trim() };
    }
  }

  return { qty: 1, cleaned: input };
}

export function expandAbbreviations(tokens: string[]): string[] {
  const expanded: string[] = [];
  for (const token of tokens) {
    const replacement = ABBREVIATIONS[token];
    if (!replacement) {
      expanded.push(token);
      continue;
    }

    expanded.push(...replacement.split(" "));
  }
  return expanded;
}

export function normalizeName(raw: string): string {
  const { cleaned } = detectQuantity(raw);
  const canonical = cleanPunctuation(cleaned.toLowerCase());
  if (!canonical) return "";

  const baseTokens = canonical.split(" ").filter(Boolean);
  const expanded = expandAbbreviations(baseTokens);
  const filtered = expanded.filter((token) => token.length > 0 && !RECEIPT_NOISE_TOKENS.has(token));
  return filtered.join(" ").replace(MULTI_SPACE_RE, " ").trim();
}

export function toTitleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

export function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
}

export function buildGroupKey(params: {
  normalizedName: string;
  unitPrice: number | null;
  currency: string | null;
}): string {
  const pricePart = params.unitPrice == null ? "na" : params.unitPrice.toFixed(2);
  const currency = params.currency?.toUpperCase() ?? "USD";
  return stableHash(`${params.normalizedName}|${pricePart}|${currency}`);
}

export function shouldFlagNameForRepair(params: {
  rawName: string;
  normalizedName: string;
  confidence: number | null;
}): boolean {
  const raw = params.rawName.trim();
  const normalized = params.normalizedName.trim();
  const tokenCount = normalized.split(" ").filter(Boolean).length;
  const abbreviationHits = raw
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => ABBREVIATIONS[token] !== undefined).length;
  const vowels = raw.toLowerCase().replace(/[^a-z]/g, "").match(/[aeiou]/g)?.length ?? 0;
  const mostlyConsonants = raw.replace(/[^a-z]/gi, "").length >= 4 && vowels <= 1;
  const weirdTruncation = /[a-z]{2,}[bcdfghjklmnpqrstvwxyz]{4,}$/i.test(raw);
  const lowConfidence = params.confidence != null && params.confidence < 0.72;

  return raw.length < 6 || tokenCount <= 1 || abbreviationHits >= 1 || mostlyConsonants || weirdTruncation || lowConfidence;
}
