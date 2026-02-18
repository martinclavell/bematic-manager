#!/usr/bin/env python3
"""
Skills Loader for Claude Code
Reads .claude-skills file and combines skill files into single context

Usage:
  load-skills.py                     # Load skills from current directory
  load-skills.py /path/to/project    # Load skills from specific project
  load-skills.py --json              # Output metadata in JSON format
"""

import os
import sys
import json
import re
from pathlib import Path
from typing import List, Dict, Set, Tuple, Optional

# Configuration
SKILLS_DIR = Path.home() / '.claude' / 'skills'
SKILLS_FILE = '.claude-skills'
SKILLS_JSON_FILE = '.claude-skills.json'

# ANSI color codes for terminal output
class Colors:
    RESET = '\033[0m'
    BRIGHT = '\033[1m'
    GREEN = '\033[32m'
    RED = '\033[31m'
    YELLOW = '\033[33m'
    BLUE = '\033[34m'
    GRAY = '\033[90m'


def load_skills_config(project_path: Path) -> Optional[Dict]:
    """Load skills configuration from project"""
    # Try JSON format first
    json_path = project_path / SKILLS_JSON_FILE
    if json_path.exists():
        try:
            with open(json_path, 'r') as f:
                config = json.load(f)
                return {
                    'skills': config.get('skills', []),
                    'format': 'json',
                    'config': config
                }
        except json.JSONDecodeError as e:
            print(f"{Colors.RED}✗ Error parsing {SKILLS_JSON_FILE}:{Colors.RESET} {e}", file=sys.stderr)
            sys.exit(1)

    # Try simple text format
    text_path = project_path / SKILLS_FILE
    if text_path.exists():
        with open(text_path, 'r') as f:
            skills = [
                line.strip()
                for line in f.readlines()
                if line.strip() and not line.strip().startswith('#')
            ]

        return {
            'skills': skills,
            'format': 'text',
            'config': None
        }

    return None


def parse_skill_frontmatter(content: str) -> Tuple[Optional[Dict], str]:
    """Parse skill frontmatter if present"""
    frontmatter_match = re.match(r'^---\n([\s\S]*?)\n---\n', content)

    if not frontmatter_match:
        return None, content

    frontmatter_text = frontmatter_match.group(1)
    content_without_frontmatter = content[len(frontmatter_match.group(0)):]

    # Simple YAML parsing (basic implementation)
    frontmatter = {}
    lines = frontmatter_text.split('\n')

    for line in lines:
        match = re.match(r'^(\w+):\s*(.+)$', line)
        if match:
            key = match.group(1)
            value = match.group(2).strip()

            # Handle arrays
            if value.startswith('[') and value.endswith(']'):
                value = [
                    s.strip().strip('"\'')
                    for s in value[1:-1].split(',')
                ]

            frontmatter[key] = value

    return frontmatter, content_without_frontmatter


def resolve_skill_dependencies(
    skill_name: str,
    all_skills: List[str],
    resolved: Set[str] = None,
    resolving: Set[str] = None
) -> List[str]:
    """Resolve skill dependencies"""
    if resolved is None:
        resolved = set()
    if resolving is None:
        resolving = set()

    if skill_name in resolved:
        return []
    if skill_name in resolving:
        print(f"{Colors.RED}✗ Circular dependency detected:{Colors.RESET} {skill_name}", file=sys.stderr)
        return []

    skill_path = SKILLS_DIR / f"{skill_name}.md"
    if not skill_path.exists():
        return []

    resolving.add(skill_name)

    with open(skill_path, 'r', encoding='utf-8') as f:
        content = f.read()

    frontmatter, _ = parse_skill_frontmatter(content)

    dependencies = []

    if frontmatter and 'requires' in frontmatter:
        requires = frontmatter['requires']
        if not isinstance(requires, list):
            requires = [requires]

        for dep in requires:
            dependencies.extend(resolve_skill_dependencies(dep, all_skills, resolved, resolving))

    dependencies.append(skill_name)
    resolved.add(skill_name)
    resolving.discard(skill_name)

    return dependencies


def load_skills_for_project(
    project_path: Optional[str] = None,
    options: Optional[Dict] = None
) -> str:
    """Load and combine skills for a project"""
    if project_path is None:
        project_path = os.getcwd()

    if options is None:
        options = {'json': False, 'silent': False}

    project_path = Path(project_path)

    # Load configuration
    config = load_skills_config(project_path)

    if not config:
        if not options['silent']:
            print(f"{Colors.YELLOW}⚠{Colors.RESET} No {SKILLS_FILE} or {SKILLS_JSON_FILE} found in {project_path}", file=sys.stderr)
        return json.dumps({'error': 'No skills configuration found'}) if options['json'] else ''

    if not config['skills']:
        if not options['silent']:
            print(f"{Colors.YELLOW}⚠{Colors.RESET} No active skills found in configuration", file=sys.stderr)
        return json.dumps({'error': 'No active skills'}) if options['json'] else ''

    # Resolve all dependencies
    all_skills_ordered = []
    seen = set()

    for skill in config['skills']:
        dependencies = resolve_skill_dependencies(skill, config['skills'])
        for dep in dependencies:
            if dep not in seen:
                all_skills_ordered.append(dep)
                seen.add(dep)

    # Load each skill file
    loaded_skills = []
    missing_skills = []
    skills_content = []
    skills_metadata = []

    for skill_name in all_skills_ordered:
        skill_path = SKILLS_DIR / f"{skill_name}.md"

        if skill_path.exists():
            with open(skill_path, 'r', encoding='utf-8') as f:
                raw_content = f.read()

            frontmatter, content = parse_skill_frontmatter(raw_content)

            skills_content.append(content)
            loaded_skills.append(skill_name)

            if options['json']:
                skills_metadata.append({
                    'name': skill_name,
                    'path': str(skill_path),
                    'frontmatter': frontmatter,
                    'size': len(raw_content)
                })
        else:
            missing_skills.append(skill_name)

    # Report results to stderr
    if not options['silent']:
        if loaded_skills:
            print(f"{Colors.GREEN}✓{Colors.RESET} Loaded skills: {', '.join(loaded_skills)}", file=sys.stderr)
        if missing_skills:
            print(f"{Colors.RED}✗{Colors.RESET} Missing skills: {', '.join(missing_skills)}", file=sys.stderr)

    # Return appropriate format
    if options['json']:
        return json.dumps({
            'project': str(project_path),
            'configuration': config,
            'loadedSkills': loaded_skills,
            'missingSkills': missing_skills,
            'skills': skills_metadata
        }, indent=2)
    else:
        # Combine all skills with separator
        return '\n\n---\n\n'.join(skills_content)


def show_usage():
    """Show usage information"""
    print(f"""
{Colors.BRIGHT}Claude Skills Loader{Colors.RESET}

Load and combine skill files for Claude Code projects.

{Colors.BRIGHT}Usage:{Colors.RESET}
  load-skills.py [options] [project-path]

{Colors.BRIGHT}Options:{Colors.RESET}
  --json          Output metadata in JSON format
  --silent        Suppress stderr output (only show content)
  --help, -h      Show this help message

{Colors.BRIGHT}Examples:{Colors.RESET}
  load-skills.py                                    # Load skills from current directory
  load-skills.py /path/to/project                   # Load skills from specific project
  load-skills.py --json                             # Get metadata about loaded skills
  load-skills.py --silent | pbcopy                  # Copy skills to clipboard (macOS)
  load-skills.py --silent > skills-context.md       # Save to file

{Colors.BRIGHT}Configuration:{Colors.RESET}
  Projects should have either:
  - {Colors.BLUE}.claude-skills{Colors.RESET}      Simple text file with one skill per line
  - {Colors.BLUE}.claude-skills.json{Colors.RESET} JSON configuration with additional options

{Colors.BRIGHT}Skills Directory:{Colors.RESET}
  {SKILLS_DIR}
""")


def main():
    """Main execution"""
    args = sys.argv[1:]
    options = {
        'json': False,
        'silent': False
    }

    project_path = None

    # Parse arguments
    for i, arg in enumerate(args):
        if arg in ('--help', '-h'):
            show_usage()
            sys.exit(0)
        elif arg == '--json':
            options['json'] = True
        elif arg == '--silent':
            options['silent'] = True
        elif not arg.startswith('-'):
            project_path = os.path.abspath(arg)
        else:
            print(f"{Colors.RED}Unknown option:{Colors.RESET} {arg}", file=sys.stderr)
            show_usage()
            sys.exit(1)

    # Load and output skills
    result = load_skills_for_project(project_path, options)

    if result:
        print(result)
    elif not options['silent']:
        sys.exit(1)


if __name__ == '__main__':
    main()