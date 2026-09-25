const fs = require('fs');
const path = require('path');

const questionsFile = path.join(__dirname, 'data', 'python-questions.json');

// Read existing questions
let questions = [];
try {
  questions = JSON.parse(fs.readFileSync(questionsFile, 'utf8'));
} catch (err) {
  console.log("No existing questions found, starting fresh.");
}

// Generate new ID
const nextId = questions.length ? Math.max(...questions.map(q => q.id)) + 1 : 1;

// Define the new multiline question
const newQuestion = {
  id: nextId,
  prompt: `Consider the following Python code:

def greet(name):
    print("Hello, " + name)

greet("Alice")

What will this code output?`,
  options: [
    "Hello, name",
    "Hello, Alice",
    "greet(\"Alice\")",
    "An error will occur"
  ],
  correct: 1,
  explanation: "The function substitutes the variable 'name' with 'Alice' and prints it."
};

// Add and save
questions.push(newQuestion);
fs.writeFileSync(questionsFile, JSON.stringify(questions, null, 2), 'utf8');

console.log("✅ Successfully added a 2-line text question to data/python-questions.json!");
console.log("Restart your server to see the new question.");
