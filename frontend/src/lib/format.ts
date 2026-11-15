/** Strip tags from editor HTML, for a short plain-text excerpt. */
export const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
