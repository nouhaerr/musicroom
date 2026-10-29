// In a database LIKE pattern, % and _ are wildcards: a search escapes them, and the escape character itself
export const literal = (text: string) => text.replace(/[\\%_]/g, (character) => `\\${character}`);
