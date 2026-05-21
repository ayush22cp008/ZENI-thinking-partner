# ZENI — Private AI Thinking Partner

A real-time, offline-first computer engineering companion for brainstorming, structuring thoughts, and compiling master prompts for AI coding agents.

[![Mode](https://img.shields.io/badge/Mode-Offline--First%20%2F%20Private-blue)](#)
[![LLM](https://img.shields.io/badge/LLMs-Ollama%20%2F%20Groq%20Cloud-orange)](https://ollama.com/)
[![Framework](https://img.shields.io/badge/Framework-React%20%2B%20Vite%20%2B%20TailwindCSS-black)](https://vite.dev/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

---

## Overview

**ZENI** is a high-performance, personalized AI thinking partner designed specifically to bridge the gap between chaotic developer brainstorming ("brain-dumping") and structured, agent-ready code generation. By capturing raw, unstructured inputs (thoughts, bugs, design ideas, or code blocks), ZENI processes them in real time, parses goals and next steps, and helps the developer forge them into perfect, executable prompts for coding subagents (like Antigravity, Cursor, or Claude).

ZENI operates on a dual-mode architecture. By default, it is **fully private and offline-first**, routing all requests through local Ollama configurations. For web demonstration and portfolio showcase purposes, it toggle-shifts to **Demo Mode**, utilizing the high-speed Groq Cloud API.

> **Primary System:** Local React application (Vite-powered).  
> All session logs, project configurations, and power parameters are persisted locally via browser storage to guarantee absolute data privacy.

---

## Features

- **Adaptive Neural Workspace** — Dynamically builds system prompts from the active project context (Project Name, Stack, Goal). Automatically switches to "quick-dump mode" when no project context is provided.
- **THINK Mode** — An interactive, chat-based thinking environment with streamed token responses. ZENI is tuned to be concise and direct, pushing back on vague ideas and ending every response with a single, sharp follow-up question.
- **FORGE Mode** — A prompt-engineering workbench that refines rough concepts into high-quality instructions. Includes a one-click **✨ Enhance** system to structure instructions and a copy utility.
- **SNAP Prompt (⚡ SNAP)** — A granular prompt-capturing utility next to every message. It captures the context of the active conversation up to that point and compiles it into a single, high-quality instruction.
- **READY TO BUILD (🚀 READY TO BUILD)** — Instantly converts a complete multi-turn THINK session and its parsed, structured parameters into a single master instruction, capped with the directive: *"Build this now. Ask if anything unclear."*
- **Structured Metadata Parsing** — Real-time parsing of `<structured>` XML-like blocks containing JSON objects. Goals, Tasks, Hypotheses, and Next Steps are extracted and displayed in dedicated, neon-stylized sidebar sections.
- **Bilingual Gujarati Translation Engine** — A built-in toggle allowing input in Gujarati. ZENI automatically translates queries to English internally to ensure LLM prompt coherence, while keeping the interface language fluid.
- **Gamified Power & Theme Engine** — Gamifies coding sessions using activity metrics. Earning XP updates the user's power level and triggers real-time CSS theme-shifting (color accents, glows, custom SVG character background layouts, and a level-up overlay).

---

## Tech Stack

| Layer | Tools |
|---|---|
| **Core UI Framework** | React 19 (JavaScript), Vite 8 |
| **Styling & Animation** | TailwindCSS v4, Vanilla CSS (glow cycles, aura transforms, scanline layers) |
| **Local LLM Orchestrator** | Ollama (Model: `llama3.2`) |
| **Cloud LLM Orchestrator** | Groq Cloud API (Model: `llama-3.1-8b-instant`) |
| **Environment Control** | dotenv (`.env` file gating) |
| **State & Persistence** | React hooks (`useState`, `useEffect`, `useRef`), Browser LocalStorage |
| **Build Tooling & Server** | Vite HMR, http-proxy configuration |

---

## How It Works

1. **Context Initialization:** The user provides active project context parameters (name, stack, goal) in the **ZENI Core** configuration panel.
2. **Dual-Mode API Gating:** The application checks the environment settings (`VITE_MODE`). It chooses either the local Ollama endpoint (`/ollama/api/chat`) via a Vite proxy or the Groq cloud completions endpoint (`https://api.groq.com/openai/v1/chat/completions`) using custom headers.
3. **Internal Translation (Optional):** If Gujarati mode is toggled, ZENI uses the LLM to translate inputs to English before sending them to the chat model.
4. **Structured Parsing:** ZENI extracts JSON formats from `<structured>` tags in responses, separating dialogue from actionable tasks and rendering them in the structured summary container.
5. **Gamification Progression:** The system calculates the power rating based on active metrics:
   $$\text{XP} = (\text{sessions} \times 100) + (\text{hoursSpent} \times 500) + (\text{problemsSolved} \times 200) + (\text{promptsGenerated} \times 150)$$
   When the XP matches a new tier, a "ZENI Evolved" level-up screen triggers, and the theme updates globally.
6. **Prompt Extraction:** The developer uses **SNAP** or **READY TO BUILD** to extract the conversation as a master prompt, or downloads the session as a markdown report.

---

## Gamified Forms & Progression

ZENI features 10 distinct power forms that shift the visual styling of the user interface.

| Form | Required XP | Accent Color | Visual Theme & Elements |
|---|---|---|---|
| **ZENI AWAKENED** | `0` | `#7c3aed` (Purple) | Initial form. Spiky hair warrior aura SVG background. |
| **ZENI KAIOKEN** | `500` | `#dc2626` (Red) | Red glow, crimson borders. Cloaked silhouette background. |
| **ZENI GOLDEN** | `1,500` | `#fbbf24` (Gold) | Gold aura, bright yellow glows, gold spiky accents. |
| **ZENI CHARGED** | `4,000` | `#f59e0b` (Amber) | High brightness golden aura, orange lightning flashes. |
| **ZENI UNLEASHED** | `9,000` | `#f97316` (Orange) | Headband ninja style orange theme, orange details. |
| **ZENI DIVINE** | `20,000` | `#ef4444` (Light Red) | Crimson red theme, high-saturation red glows. |
| **ZENI ASCENDED** | `40,000` | `#06b6d4` (Teal) | Cyan borders, teal aura lines, cyan particle glows. |
| **ZENI INSTINCT** | `80,000` | `#94a3b8` (Silver) | Silver-grey accents, dark panel shading, clean white text. |
| **ZENI PERFECTED** | `150,000` | `#ffffff` (White) | Stark white accents, high brightness, border glows. |
| **ZENI INFINITE** | `300,000` | `#a78bfa` (Violet) | Ultra-glowing violet borders, dark backgrounds. |

---

## Challenges & Solutions

| Challenge | Technical Solution |
|---|---|
| **Frontend-Only Architecture (No Backend)** | Decoupled server dependencies. Communicated directly with Ollama using Vite's server proxy config (`vite.config.js`) to bypass CORS blocks in development, and wrote direct API integrations to Groq for Vercel/production deployment. |
| **Generic AI Personality Overfit** | Standard chat models default to generic, wordy advice and corporate bullet points, which stall rapid developer brainstorming. Through multiple prompt iterations, ZENI was constrained by a custom-compiled system prompt to be direct, sharp, refuse conversational fluff, push back on vague ideas, and end every turn with exactly one thought-provoking question. |
| **Hardcoded Style Values** | Removed hardcoded hex values (like purple `#7c3aed`) from layouts. Replaced them with dynamic styling bindings (`C.accent`, `C.glow`, `C.border`, `C.panel`) mapped dynamically to the current gamified form. |
| **Groq Model Decommissioning** | The decommissioned model `llama3-8b-8192` returned `400 Bad Request` errors. Migrated the API integration configuration to utilize `llama-3.1-8b-instant`. |
| **Scrollbar Layout Aesthetics** | Replaced default browser scrollbars with custom CSS overrides. Hid track lines and set minimalist scrollbars with translucent thumbs for a clean workspace interface. |

---

## Project Structure

```
thinking-companion/
├── public/                 # Static assets
│   ├── dragon.png          # Logo asset for evolution overlays
│   ├── favicon.svg         # Application icon
│   └── icons.svg           # UI icons
├── src/
│   ├── assets/             # Sub-assets
│   ├── App.css             # Component-level styles
│   ├── App.jsx             # Main application file (routing, API helpers, UI)
│   ├── index.css           # Global styles, scrollbar setups, keyframe animations
│   └── main.jsx            # React root mount
├── .env                    # Local environment config (git-ignored)
├── .env.example            # Environment template config
├── .gitignore              # Ignored files (node_modules, .env)
├── eslint.config.js        # Linter configuration
├── index.html              # Main HTML frame
├── package.json            # Scripts and dependencies
└── vite.config.js          # Vite config (Conditional proxy for local Ollama)
```

---

## Setup & Running

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later recommended)
- [Ollama](https://ollama.com/) (Required for local/private mode)
  - Install Ollama and pull the Llama 3.2 model:
    ```bash
    ollama run llama3.2
    ```

### Installation

1. Clone or download this repository.
2. Open a terminal in the project directory.
3. Install the dependencies:
   ```bash
   npm install
   ```

### Environment Configuration

Create a `.env` file in the root directory (or copy `.env.example`):
```bash
# Set mode to 'private' (local Ollama) or 'demo' (Groq Cloud)
VITE_MODE=private

# If VITE_MODE=demo, add your Groq API key (get one from https://console.groq.com)
VITE_GROQ_API_KEY=your_groq_api_key_here
```

### Running the Application

Start the local development server:
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Author

**Ayush Halpati**  
B.Tech Computer Engineering — BVM Engineering College, Vallabh Vidyanagar  
Internship at Invisible Fiction, V.V. Nagar, Anand, Gujarat

---

## License

This project is licensed under the [MIT License](LICENSE).
