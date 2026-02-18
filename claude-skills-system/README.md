# Claude Skills System

A comprehensive system for managing reusable domain knowledge ("skills") for Claude Code across multiple projects. Skills are markdown files containing patterns, rules, APIs, and conventions that can be loaded on-demand based on project requirements.

## 🚀 Quick Start

### Installation

**Unix/Linux/macOS:**
```bash
chmod +x install.sh
./install.sh
```

**Windows:**
```batch
install.bat
```

### Basic Usage

1. **Initialize skills in a project:**
   ```bash
   cd /path/to/your/project
   claude-skills init
   ```

2. **Add skills to your project:**
   ```bash
   claude-skills add suitecommerce-advanced
   claude-skills add netsuite-suitescript-2
   ```

3. **Load skills for Claude:**
   ```bash
   load-skills
   ```

## 📁 System Structure

```
~/.claude/
├── CLAUDE.md          # Global instructions
└── skills/            # Skills library
    ├── suitecommerce-advanced.md
    ├── netsuite-suitescript-1.md
    ├── netsuite-suitescript-2.md
    ├── react-patterns.md
    └── ...

<project>/
├── .claude-skills     # Active skills list (simple format)
└── .claude-skills.json # Active skills with metadata (advanced)
```

## 🛠️ Components

### 1. Skills Files
Markdown documents containing domain-specific knowledge:
- Patterns and best practices
- API references
- Common pitfalls
- Code examples

### 2. Loader Scripts
- **load-skills** - Node.js implementation
- **load-skills.py** - Python implementation

Load and combine active skills for a project.

### 3. CLI Tool
**claude-skills** - Manage skills for projects:
- `init` - Initialize skills configuration
- `add <skill>` - Add skill to project
- `remove <skill>` - Remove skill from project
- `list` - List all available skills
- `show` - Show active skills
- `create <skill>` - Create new skill template
- `validate <skill>` - Validate skill syntax
- `search <query>` - Search skills by keyword
- `info <skill>` - Show skill details

### 4. Slack Integration
Three integration approaches provided:
- Direct injection into prompts
- Anthropic API integration
- File handoff method

## 📝 Configuration Formats

### Simple Format (.claude-skills)
```
# Active skills for this project
suitecommerce-advanced
netsuite-suitescript-1
react-patterns
```

### JSON Format (.claude-skills.json)
```json
{
  "skills": [
    "suitecommerce-advanced",
    "netsuite-suitescript-1"
  ],
  "auto_detect": true,
  "project_type": "netsuite-sca",
  "metadata": {
    "team": "Backend Team",
    "created": "2024-01-15"
  }
}
```

## 🎯 Skill File Format

### Basic Skill
```markdown
# Skill Name

## Overview
Brief description of the skill domain.

## Key Patterns
- Pattern descriptions

## Examples
```code
// Example code
```
```

### Advanced Skill with Frontmatter
```markdown
---
skill: skill-name
version: 1.0
tags: [tag1, tag2]
description: Brief description
requires: [dependency-skill]
author: Your Name
updated: 2024-01-15
---

# Skill Name
[Content...]
```

## 🔧 Advanced Features

### Skill Dependencies
Skills can declare dependencies on other skills:
```yaml
requires: [base-skill, another-skill]
```
Dependencies are automatically loaded in the correct order.

### Auto-Detection
The system can suggest skills based on project structure:
- Detects `manifest.json` → Suggests SuiteCommerce skills
- Detects `package.json` with React → Suggests React skills
- Detects `requirements.txt` → Suggests Python skills

### Loader Options
```bash
# Load skills quietly
load-skills --silent

# Get JSON metadata
load-skills --json

# Load from specific project
load-skills /path/to/project
```

## 🤝 Slack Integration

### Method 1: Direct Injection
```javascript
const skillsContext = loadSkillsForProject(projectPath);
const enhancedPrompt = `
${skillsContext}

User Request: ${userMessage}
`;
```

### Method 2: API Integration
```javascript
const systemPrompt = globalInstructions + '\n' + formatSkills(projectSkills);
const message = await anthropic.messages.create({
  system: systemPrompt,
  messages: [{ role: 'user', content: userMessage }]
});
```

### Method 3: File Handoff
```javascript
const contextFile = writeContextFile(sessionId, userMessage, skills);
await launchClaudeCode(contextFile, projectPath);
```

See `slack-integrations/` for complete examples.

## 🏗️ Creating Custom Skills

1. **Create skill file:**
   ```bash
   claude-skills create my-custom-skill
   ```

2. **Edit the generated template:**
   ```bash
   vim ~/.claude/skills/my-custom-skill.md
   ```

3. **Validate the skill:**
   ```bash
   claude-skills validate my-custom-skill
   ```

4. **Use in projects:**
   ```bash
   claude-skills add my-custom-skill
   ```

## 📋 Available Skills

### NetSuite/SuiteCommerce
- `suitecommerce-advanced` - SCA development patterns
- `netsuite-suitescript-1` - SuiteScript 1.0 API reference
- `netsuite-suitescript-2` - SuiteScript 2.x patterns

### Frontend
- `react-patterns` - Modern React patterns
- `typescript-best-practices` - TypeScript best practices

### Backend
- `python-fastapi` - FastAPI development patterns

## 🔍 Troubleshooting

### Skills not loading
1. Check `.claude-skills` exists in project
2. Verify skill names match files in `~/.claude/skills/`
3. Run `claude-skills validate <skill>` to check syntax

### Command not found
1. Ensure `~/bin` is in your PATH
2. Restart terminal after installation
3. Check executable permissions

### Slack integration issues
1. Verify environment variables are set
2. Check channel-to-project mappings
3. Ensure skills loader is accessible

## 🤝 Contributing

To add new skills to the system:

1. Create skill file following the format
2. Add comprehensive examples
3. Include common pitfalls section
4. Test with `claude-skills validate`
5. Document any dependencies

## 📜 License

This system is designed to work with Claude Code and can be customized for your team's needs.

## 🙏 Acknowledgments

Built to enhance Claude Code's effectiveness by providing project-specific domain knowledge on demand.