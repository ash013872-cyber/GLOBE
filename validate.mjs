import { readFile } from "node:fs/promises";

const files = ["index.html", "styles.css", "app.js"];
for (const file of files) {
  const source = await readFile(file, "utf8");
  if (!source.trim()) throw new Error(`${file} is empty`);
}
const html = await readFile("index.html", "utf8");
const required = ["styles.css", "app.js"];
for (const file of required) {
  if (!html.includes(`href="${file}"`) && !html.includes(`src="${file}"`)) {
    throw new Error(`${file} is not referenced by index.html`);
  }
}
console.log("GLOBE static files look valid.");
