/**
 * Splits documents into embedding-sized chunks. Prefers paragraph boundaries
 * so a chunk stays semantically whole; falls back to sentence and then hard
 * splits for very long unbroken text.
 */
const TARGET_CHARS = 1200;
const OVERLAP_CHARS = 150;

function hardSplit(text: string, max: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max));
  return out;
}

/** Split oversized paragraphs on sentence boundaries where possible. */
function splitLongParagraph(paragraph: string): string[] {
  if (paragraph.length <= TARGET_CHARS) return [paragraph];
  const sentences = paragraph.match(/[^.!?\n]+[.!?]+\s*|\S+\s*/g) ?? [paragraph];
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current !== "" && current.length + sentence.length > TARGET_CHARS) {
      parts.push(current.trim());
      current = "";
    }
    if (sentence.length > TARGET_CHARS) {
      if (current.trim() !== "") parts.push(current.trim());
      current = "";
      parts.push(...hardSplit(sentence, TARGET_CHARS));
      continue;
    }
    current += sentence;
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
}

export function chunkText(text: string): string[] {
  const normalised = text.replace(/\r\n/g, "\n").trim();
  if (normalised === "") return [];

  const paragraphs = normalised.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p !== "");
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    for (const piece of splitLongParagraph(paragraph)) {
      if (current !== "" && current.length + piece.length + 2 > TARGET_CHARS) {
        chunks.push(current.trim());
        // Carry a little context forward so meaning isn't cut at the seam.
        const tail = current.slice(-OVERLAP_CHARS);
        const breakAt = tail.indexOf(" ");
        current = breakAt === -1 ? "" : `${tail.slice(breakAt + 1)}\n\n`;
      }
      current += `${piece}\n\n`;
    }
  }
  if (current.trim() !== "") chunks.push(current.trim());
  return chunks;
}
