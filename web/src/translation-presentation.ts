export interface TranslationPresentationBlock {
  kind: "text" | "title" | "caption" | "formula" | "image" | "table" | "code" | "other";
  source_text: string;
  translated_text: string | null;
}

export interface TranslationPagePresentation<T extends TranslationPresentationBlock> {
  blocks: T[];
  pageInformation: T[];
  hiddenVisualBlocks: number;
}

const visualKinds = new Set(["formula", "image", "table", "other"]);
const contentsPattern = /^contents\s+lists?\s+available\s+at\b/i;
const homepagePattern = /^journal\s+homepage\s*:\s*\S+/i;

function sourceLines(block: TranslationPresentationBlock) {
  return block.source_text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function isPublisherPreface(block: TranslationPresentationBlock) {
  if (block.kind !== "text") return false;
  const lines = sourceLines(block);
  return lines.length > 0 && lines.every((line) => contentsPattern.test(line) || homepagePattern.test(line));
}

export function presentTranslationBlocks<T extends TranslationPresentationBlock>(blocks: readonly T[], _page: number): TranslationPagePresentation<T> {
  const preface = blocks.map(isPublisherPreface);

  const main: T[] = [];
  const pageInformation: T[] = [];
  let hiddenVisualBlocks = 0;
  blocks.forEach((block, index) => {
    if (preface[index]) {
      pageInformation.push(block);
      return;
    }
    const missingVisualTranslation = visualKinds.has(block.kind)
      && (typeof block.translated_text !== "string" || !block.translated_text.trim());
    if (missingVisualTranslation) {
      hiddenVisualBlocks += 1;
      return;
    }
    main.push(block);
  });
  return { blocks: main, pageInformation, hiddenVisualBlocks };
}
