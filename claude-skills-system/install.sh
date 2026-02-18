#!/bin/bash

# Claude Skills System Installation Script
# This script sets up the Claude Skills System on your machine

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

# Header
echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}  Claude Skills System Installer${NC}"
echo -e "${BLUE}================================${NC}"
echo

# Check if running from the claude-skills-system directory
if [ ! -f "install.sh" ]; then
    print_error "Please run this script from the claude-skills-system directory"
    exit 1
fi

# Get home directory and create paths
CLAUDE_DIR="$HOME/.claude"
SKILLS_DIR="$CLAUDE_DIR/skills"
BIN_DIR="$HOME/bin"

print_info "Installation paths:"
echo "  Claude config: $CLAUDE_DIR"
echo "  Skills directory: $SKILLS_DIR"
echo "  Executables: $BIN_DIR"
echo

# Ask for confirmation
read -p "Continue with installation? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_warning "Installation cancelled"
    exit 0
fi

# Create directories
print_info "Creating directories..."
mkdir -p "$CLAUDE_DIR"
mkdir -p "$SKILLS_DIR"
mkdir -p "$BIN_DIR"
print_success "Directories created"

# Check if skills already exist and back them up
if [ -d "$SKILLS_DIR" ] && [ "$(ls -A "$SKILLS_DIR")" ]; then
    BACKUP_DIR="$CLAUDE_DIR/skills-backup-$(date +%Y%m%d-%H%M%S)"
    print_warning "Existing skills found. Backing up to $BACKUP_DIR"
    mv "$SKILLS_DIR" "$BACKUP_DIR"
    mkdir -p "$SKILLS_DIR"
fi

# Copy skills
print_info "Installing skills..."
cp -r skills/* "$SKILLS_DIR/"
SKILL_COUNT=$(ls -1 "$SKILLS_DIR"/*.md 2>/dev/null | wc -l)
print_success "Installed $SKILL_COUNT skills"

# Install executables
print_info "Installing executables..."

# Copy and make executable
cp bin/load-skills.js "$BIN_DIR/load-skills"
chmod +x "$BIN_DIR/load-skills"
print_success "Installed load-skills"

cp bin/load-skills.py "$BIN_DIR/load-skills.py"
chmod +x "$BIN_DIR/load-skills.py"
print_success "Installed load-skills.py"

cp bin/claude-skills "$BIN_DIR/claude-skills"
chmod +x "$BIN_DIR/claude-skills"
print_success "Installed claude-skills CLI"

# Check if ~/bin is in PATH
if [[ ":$PATH:" != *":$HOME/bin:"* ]]; then
    print_warning "~/bin is not in your PATH"
    echo
    echo "Add this line to your shell configuration file (.bashrc, .zshrc, etc.):"
    echo "  export PATH=\"\$HOME/bin:\$PATH\""
    echo
fi

# Check for Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    print_success "Node.js found: $NODE_VERSION"
else
    print_warning "Node.js not found. Node.js is required for the JavaScript tools."
fi

# Check for Python
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version)
    print_success "Python found: $PYTHON_VERSION"
else
    print_warning "Python 3 not found. Python 3 is required for the Python tools."
fi

# Create example CLAUDE.md if it doesn't exist
if [ ! -f "$CLAUDE_DIR/CLAUDE.md" ]; then
    print_info "Creating example CLAUDE.md..."
    cat > "$CLAUDE_DIR/CLAUDE.md" << 'EOF'
# Claude Global Instructions

This file contains global instructions that apply to all projects.

## General Rules

- Always read existing code before making changes
- Follow the project's existing patterns and conventions
- Write minimal, focused changes
- Provide clear commit messages

## Important Reminders

- Test your changes before committing
- Document any new functions or complex logic
- Handle errors appropriately
EOF
    print_success "Created example CLAUDE.md"
else
    print_info "CLAUDE.md already exists, skipping"
fi

# Test the installation
print_info "Testing installation..."
echo

# Test claude-skills command
if command -v claude-skills &> /dev/null; then
    print_success "claude-skills command is available"
    claude-skills list | head -5
else
    print_error "claude-skills command not found"
fi

echo
print_success "Installation complete!"
echo

# Print next steps
echo -e "${BLUE}Next Steps:${NC}"
echo "1. If ~/bin wasn't in your PATH, add it and restart your shell"
echo "2. Navigate to a project directory and run: claude-skills init"
echo "3. Add skills to your project: claude-skills add <skill-name>"
echo "4. View available skills: claude-skills list"
echo "5. Load skills for Claude: load-skills"
echo
echo "For Slack integration examples, see: ./slack-integrations/"
echo "For documentation, see: ./README.md"

# Optional: Install example projects
echo
read -p "Would you like to see example project configurations? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_info "Example project configurations:"
    echo
    find examples/projects -name '.claude-skills*' -exec echo "  {}" \; -exec cat {} \; -exec echo \;
fi