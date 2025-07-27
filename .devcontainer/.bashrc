# Sim Studio Development Environment Bashrc
# This gets sourced by post-create.sh

# Enhanced prompt with git branch info
parse_git_branch() {
  git branch 2> /dev/null | sed -e '/^[^*]/d' -e 's/* \(.*\)/ (\1)/'
}

export PS1="\[\033[01;32m\]\u@simstudio\[\033[00m\]:\[\033[01;34m\]\w\[\033[33m\]\$(parse_git_branch)\[\033[00m\]\$ "

# Helpful aliases
alias ll="ls -la"
alias ..="cd .."
alias ...="cd ../.."

# Database aliases
alias pgc="PGPASSWORD=postgres psql -h db -U postgres -d simstudio"
alias check-db="PGPASSWORD=postgres psql -h db -U postgres -c '\l'"

# Sim Studio specific aliases
alias logs="cd /workspace/apps/sim && tail -f logs/*.log 2>/dev/null || echo 'No log files found'"
alias sim-start="cd /workspace && bun run dev"
alias sim-migrate="cd /workspace/apps/sim && bunx drizzle-kit push"
alias sim-generate="cd /workspace/apps/sim && bunx drizzle-kit generate"
alias sim-rebuild="cd /workspace && bun run build && bun run start"
alias docs-dev="cd /workspace/apps/docs && bun run dev"

# Turbo related commands
alias turbo-build="cd /workspace && bunx turbo run build"
alias turbo-dev="cd /workspace && bunx turbo run dev"
alias turbo-test="cd /workspace && bunx turbo run test"

# Bun specific commands
alias bun-update="cd /workspace && bun update"
alias bun-add="cd /workspace && bun add"
alias bun-pm="cd /workspace && bun pm"
alias bun-canary="bun upgrade --canary"

# Default to workspace directory
cd /workspace 2>/dev/null || true

# Welcome message - only show once per session
if [ -z "$SIM_WELCOME_SHOWN" ]; then
  export SIM_WELCOME_SHOWN=1
  
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🚀 Welcome to Sim Studio development environment!"
  echo ""
  echo "Available commands:"
  echo "  sim-start    - Start all apps in development mode"
  echo "  sim-migrate  - Push schema changes to the database for sim app"
  echo "  sim-generate - Generate new migrations for sim app"
  echo "  sim-rebuild  - Build and start all apps"
  echo "  docs-dev     - Start only the docs app in development mode"
  echo ""
  echo "Turbo commands:"
  echo "  turbo-build  - Build all apps using Turborepo"
  echo "  turbo-dev    - Start development mode for all apps"
  echo "  turbo-test   - Run tests for all packages"
  echo ""
  echo "Bun commands:"
  echo "  bun-update   - Update dependencies"
  echo "  bun-add      - Add a new dependency"
  echo "  bun-pm       - Manage dependencies"
  echo "  bun-canary   - Upgrade to the latest canary version of Bun"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
fi 