#!/usr/bin/env node
/**
 * Skills Loader for Claude Code
 * Reads .claude-skills file and combines skill files into single context
 *
 * Usage:
 *   load-skills                     # Load skills from current directory
 *   load-skills /path/to/project    # Load skills from specific project
 *   load-skills --json              # Output metadata in JSON format
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Configuration
const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');
const SKILLS_FILE = '.claude-skills';
const SKILLS_JSON_FILE = '.claude-skills.json';

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    gray: '\x1b[90m'
};

/**
 * Load skills configuration from project
 */
function loadSkillsConfig(projectPath) {
    // Try JSON format first
    const jsonPath = path.join(projectPath, SKILLS_JSON_FILE);
    if (fs.existsSync(jsonPath)) {
        try {
            const config = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            return {
                skills: config.skills || [],
                format: 'json',
                config: config
            };
        } catch (e) {
            console.error(`${colors.red}✗ Error parsing ${SKILLS_JSON_FILE}:${colors.reset}`, e.message);
            process.exit(1);
        }
    }

    // Try simple text format
    const textPath = path.join(projectPath, SKILLS_FILE);
    if (fs.existsSync(textPath)) {
        const content = fs.readFileSync(textPath, 'utf8');
        const skills = content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#')); // Remove comments and empty lines

        return {
            skills: skills,
            format: 'text',
            config: null
        };
    }

    return null;
}

/**
 * Parse skill frontmatter if present
 */
function parseSkillFrontmatter(content) {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!frontmatterMatch) {
        return { frontmatter: null, content: content };
    }

    const frontmatterText = frontmatterMatch[1];
    const contentWithoutFrontmatter = content.substring(frontmatterMatch[0].length);

    // Simple YAML parsing (basic implementation)
    const frontmatter = {};
    const lines = frontmatterText.split('\n');

    for (const line of lines) {
        const match = line.match(/^(\w+):\s*(.+)$/);
        if (match) {
            const key = match[1];
            let value = match[2].trim();

            // Handle arrays
            if (value.startsWith('[') && value.endsWith(']')) {
                value = value.slice(1, -1).split(',').map(s => s.trim().replace(/['"]/g, ''));
            }

            frontmatter[key] = value;
        }
    }

    return { frontmatter, content: contentWithoutFrontmatter };
}

/**
 * Resolve skill dependencies
 */
function resolveSkillDependencies(skillName, allSkills, resolved = new Set(), resolving = new Set()) {
    if (resolved.has(skillName)) return [];
    if (resolving.has(skillName)) {
        console.error(`${colors.red}✗ Circular dependency detected:${colors.reset} ${skillName}`);
        return [];
    }

    const skillPath = path.join(SKILLS_DIR, `${skillName}.md`);
    if (!fs.existsSync(skillPath)) {
        return [];
    }

    resolving.add(skillName);

    const content = fs.readFileSync(skillPath, 'utf8');
    const { frontmatter } = parseSkillFrontmatter(content);

    const dependencies = [];

    if (frontmatter && frontmatter.requires) {
        const requires = Array.isArray(frontmatter.requires) ? frontmatter.requires : [frontmatter.requires];
        for (const dep of requires) {
            dependencies.push(...resolveSkillDependencies(dep, allSkills, resolved, resolving));
        }
    }

    dependencies.push(skillName);
    resolved.add(skillName);
    resolving.delete(skillName);

    return dependencies;
}

/**
 * Load and combine skills for a project
 */
function loadSkillsForProject(projectPath = process.cwd(), options = {}) {
    // Load configuration
    const config = loadSkillsConfig(projectPath);

    if (!config) {
        if (!options.silent) {
            console.error(`${colors.yellow}⚠${colors.reset} No ${SKILLS_FILE} or ${SKILLS_JSON_FILE} found in ${projectPath}`);
        }
        return options.json ? JSON.stringify({ error: 'No skills configuration found' }) : '';
    }

    if (config.skills.length === 0) {
        if (!options.silent) {
            console.error(`${colors.yellow}⚠${colors.reset} No active skills found in configuration`);
        }
        return options.json ? JSON.stringify({ error: 'No active skills' }) : '';
    }

    // Resolve all dependencies
    const allSkillsOrdered = [];
    const seen = new Set();

    for (const skill of config.skills) {
        const dependencies = resolveSkillDependencies(skill, config.skills);
        for (const dep of dependencies) {
            if (!seen.has(dep)) {
                allSkillsOrdered.push(dep);
                seen.add(dep);
            }
        }
    }

    // Load each skill file
    const loadedSkills = [];
    const missingSkills = [];
    const skillsContent = [];
    const skillsMetadata = [];

    for (const skillName of allSkillsOrdered) {
        const skillPath = path.join(SKILLS_DIR, `${skillName}.md`);

        if (fs.existsSync(skillPath)) {
            const rawContent = fs.readFileSync(skillPath, 'utf8');
            const { frontmatter, content } = parseSkillFrontmatter(rawContent);

            skillsContent.push(content);
            loadedSkills.push(skillName);

            if (options.json) {
                skillsMetadata.push({
                    name: skillName,
                    path: skillPath,
                    frontmatter: frontmatter,
                    size: rawContent.length
                });
            }
        } else {
            missingSkills.push(skillName);
        }
    }

    // Report results to stderr (so stdout is clean for piping)
    if (!options.silent) {
        if (loadedSkills.length > 0) {
            console.error(`${colors.green}✓${colors.reset} Loaded skills: ${loadedSkills.join(', ')}`);
        }
        if (missingSkills.length > 0) {
            console.error(`${colors.red}✗${colors.reset} Missing skills: ${missingSkills.join(', ')}`);
        }
    }

    // Return appropriate format
    if (options.json) {
        return JSON.stringify({
            project: projectPath,
            configuration: config,
            loadedSkills: loadedSkills,
            missingSkills: missingSkills,
            skills: skillsMetadata
        }, null, 2);
    } else {
        // Combine all skills with separator
        return skillsContent.join('\n\n---\n\n');
    }
}

/**
 * Show usage information
 */
function showUsage() {
    console.log(`
${colors.bright}Claude Skills Loader${colors.reset}

Load and combine skill files for Claude Code projects.

${colors.bright}Usage:${colors.reset}
  load-skills [options] [project-path]

${colors.bright}Options:${colors.reset}
  --json          Output metadata in JSON format
  --silent        Suppress stderr output (only show content)
  --help, -h      Show this help message

${colors.bright}Examples:${colors.reset}
  load-skills                                    # Load skills from current directory
  load-skills /path/to/project                   # Load skills from specific project
  load-skills --json                             # Get metadata about loaded skills
  load-skills --silent | pbcopy                  # Copy skills to clipboard (macOS)
  load-skills --silent > skills-context.md       # Save to file

${colors.bright}Configuration:${colors.reset}
  Projects should have either:
  - ${colors.blue}.claude-skills${colors.reset}      Simple text file with one skill per line
  - ${colors.blue}.claude-skills.json${colors.reset} JSON configuration with additional options

${colors.bright}Skills Directory:${colors.reset}
  ${SKILLS_DIR}
`);
}

// Main execution
if (require.main === module) {
    const args = process.argv.slice(2);
    const options = {
        json: false,
        silent: false
    };

    let projectPath = process.cwd();

    // Parse arguments
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--help' || arg === '-h') {
            showUsage();
            process.exit(0);
        } else if (arg === '--json') {
            options.json = true;
        } else if (arg === '--silent') {
            options.silent = true;
        } else if (!arg.startsWith('-')) {
            projectPath = path.resolve(arg);
        } else {
            console.error(`${colors.red}Unknown option:${colors.reset} ${arg}`);
            showUsage();
            process.exit(1);
        }
    }

    // Load and output skills
    const result = loadSkillsForProject(projectPath, options);

    if (result) {
        console.log(result);
    } else if (!options.silent) {
        process.exit(1);
    }
}

// Export for use as module
module.exports = {
    loadSkillsForProject,
    loadSkillsConfig,
    parseSkillFrontmatter,
    resolveSkillDependencies
};