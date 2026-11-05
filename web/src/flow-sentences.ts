export interface SentenceSourceBlock {
  id: string;
  kind: string;
  source_text: string;
}

export interface SentenceTranslatedBlock extends SentenceSourceBlock {
  translated_text: string;
  sentences?: unknown;
}

export interface ValidatedSentence {
  id: string;
  source_text: string;
  translated_text: string;
}

const translatableKinds = new Set(["text", "title", "caption"]);
const controlCharacters = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const spaces = /[ \t\u00a0]+/g;
const breaks = /\n{2,}/g;
const unsafeTag = /<\s*(script|iframe|object|embed|style|link|img|svg|math)\b/i;
const maxTranslationCharacters = 8000;

function normalizedTarget(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(controlCharacters, "")
    .replace(spaces, " ")
    .replace(breaks, "\n")
    .trim();
}

function validTarget(value: string) {
  if (!value || normalizedTarget(value) !== value || unsafeTag.test(value) || value.toLowerCase().includes("javascript:")) return false;
  let length = 0;
  for (const _character of value) {
    length += 1;
    if (length > maxTranslationCharacters) return false;
  }
  return true;
}

export function validatedSentences(source: SentenceSourceBlock, translated: SentenceTranslatedBlock): ValidatedSentence[] | null {
  if (
    !translatableKinds.has(source.kind)
    || translated.id !== source.id
    || translated.kind !== source.kind
    || translated.source_text !== source.source_text
    || typeof translated.translated_text !== "string"
    || !validTarget(translated.translated_text)
    || !Array.isArray(translated.sentences)
    || translated.sentences.length < 1
    || translated.sentences.length > 128
  ) return null;

  const sentences: ValidatedSentence[] = [];
  for (let index = 0; index < translated.sentences.length; index += 1) {
    const value: unknown = translated.sentences[index];
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const sentence = value as Partial<ValidatedSentence>;
    if (
      sentence.id !== `${source.id}-s${index}`
      || typeof sentence.source_text !== "string"
      || !sentence.source_text.length
      || typeof sentence.translated_text !== "string"
      || !validTarget(sentence.translated_text)
    ) return null;
    sentences.push({
      id: sentence.id,
      source_text: sentence.source_text,
      translated_text: sentence.translated_text
    });
  }

  if (sentences.map((sentence) => sentence.source_text).join("") !== source.source_text) return null;
  if (sentences.map((sentence) => sentence.translated_text).join(" ") !== translated.translated_text) return null;
  return sentences;
}
