# Grindstone

Adaptive practice for DSA, Machine Learning, C++ and CS core subjects. Pick what you want to practise and Grindstone picks the next best question for your level, tracks how you're improving, and keeps throwing similar questions at you until a topic sticks.

## Features

- **Four tracks:** DSA & Coding, Machine Learning, C++, CS Core (OS, DBMS, Networks, System Design)
- **Three formats:** multiple choice, flip flashcards, and coding problems with a built-in test runner
- **Adaptive level:** an Elo-style rating per track that updates after every answer based on question difficulty, with tiers (Rookie → Master) and a rating history sparkline
- **Smart picker:** chooses the next question from your rating, weakest topics, unseen questions and mistakes due for review, and shows *why* it picked it
- **Code runner:** JavaScript solutions run in a Web Worker against test cases, with a 2 s timeout for infinite loops
- **Similar questions:** ranked by shared topics, difficulty and format
- **Mistake review:** missed questions come back a few questions later (spaced repetition)
- **Topic mastery bars:** tap any topic to drill it
- **Daily XP goal, streaks and accuracy**, saved in the browser (`localStorage`)
- **AI features (when opened inside Claude):** twin generator (same / easier / harder), hints, code review and topic cheat sheets. Generated code twins are verified against their own tests before they're shown.

## Run it

It's a single static file, no build step:

```bash
git clone https://github.com/AKARSH24012006/Grindstone.git
cd Grindstone
# open index.html in a browser, or serve it:
python3 -m http.server 8000
```

Then visit `http://localhost:8000`. It also works on GitHub Pages (Settings → Pages → deploy from `main`).

The AI buttons use Claude's artifact runtime, so they only work when the page is opened as a Claude artifact. Everywhere else they show a short message and the rest of the app works normally.

## How the adaptive engine works

- **Rating update:** `expected = 1 / (1 + 10^((difficulty − rating) / 400))`, then `rating += 32 × (score − expected)`
- **Score:** MCQ is 0 or 1; flashcards are self-graded (0 / 0.45 / 0.8 / 1); code scores 1 on first pass, less with more attempts, 0 if you reveal the solution
- **Topic mastery:** exponential moving average of scores per tag
- **Next question score:** closeness to your rating + weakness of its topics + due-for-review bonus + new-question bonus − recently-seen penalty

## Roadmap

- Backend (Node/Express + MongoDB) with accounts and synced progress
- Bigger question bank and admin upload
- C++ and Python code execution via a sandboxed judge
- Server-side LLM question generation and grading
- Notes mode with spaced-repetition decks

## Tech

HTML, CSS and vanilla JavaScript. Fonts: Unbounded, Figtree, JetBrains Mono.
