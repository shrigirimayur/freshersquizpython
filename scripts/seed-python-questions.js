const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "data", "python-questions.json");
const questions = JSON.parse(fs.readFileSync(file, "utf8"));

if (questions.length !== 20)
  throw new Error(`Expected 20 Python questions, found ${questions.length}.`);
for (const question of questions) {
  if (
    !question.prompt ||
    question.options?.length !== 4 ||
    question.correct < 0 ||
    question.correct > 3
  ) {
    throw new Error(`Invalid question ${question.id}.`);
  }
}

console.log(`Validated ${questions.length} Python questions in ${file}.`);
console.log("Restart node server.js to load this question bank.");
