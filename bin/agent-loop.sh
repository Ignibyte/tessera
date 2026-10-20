#!/bin/bash
# =============================================================================
# bin/agent-loop.sh — works the backlog, one Claude Code session per ticket
# =============================================================================
#
# Picks an in-progress ticket first (a session that stopped mid-ticket), else
# the lowest-numbered open one, and runs `claude -p` on it with the workflow
# in CLAUDE.md. Blocked tickets are skipped. Stops when nothing is left, when
# `.agent-stop` exists (checked between tickets), or when one ticket has not
# moved after three sessions. Each session's stream is kept in .agent-logs/.
#
# Run it in tmux:  tmux new -d -s tessera bin/agent-loop.sh
# Stop it:         touch .agent-stop   (after the current ticket)
# Effort:          TESSERA_AGENT_EFFORT (default high)
# =============================================================================

set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT" || exit 2
LOGS="$ROOT/.agent-logs"
mkdir -p "$LOGS"
EFFORT="${TESSERA_AGENT_EFFORT:-high}"

# The ticket to work: in-progress first, else the lowest open; empty for none.
pick() {
    local n
    n=$(bin/ticket.sh list --status in-progress | grep -E -o '^#[0-9]{4}' | head -1)
    [ -n "$n" ] || n=$(bin/ticket.sh list --status open | grep -E -o '^#[0-9]{4}' | head -1)
    [ -n "$n" ] && printf '%d\n' "$((10#${n#\#}))"
}

# The ticket's status and phase, to tell whether a session moved it.
state() {
    grep -E '^(status|phase):' "$(bin/ticket.sh path "$1")" | tr '\n' ' '
}

# Shows the session's stream as text: what it says and which tools it runs.
show() {
    jq -r --unbuffered '
        if .type == "assistant" then
            .message.content[]? |
            if .type == "text" then "▌ " + .text
            elif .type == "tool_use" then
                "  → " + .name + " " + ((.input.command // .input.file_path // .input.pattern // .input.description // "") | tostring | gsub("\n"; " ⏎ ") | .[0:180])
            else empty end
        elif .type == "result" then
            "== session " + (.subtype // "?") + ", " + ((.num_turns // 0) | tostring) + " turns, $" + ((.total_cost_usd // 0) * 100 | round / 100 | tostring)
        else empty end' 2>/dev/null
}

last=""
tries=0
while :; do
    if [ -e .agent-stop ]; then
        rm -f .agent-stop
        echo "agent-loop: .agent-stop found; stopping."
        break
    fi
    if [ -z "$(git status --porcelain)" ] && [ "$(git branch --show-current)" != main ]; then
        git switch -q main
    fi
    [ "$(git branch --show-current)" = main ] && git pull -q --ff-only

    n=$(pick)
    if [ -z "$n" ]; then
        echo "agent-loop: no open or in-progress tickets; done."
        bin/ticket.sh list --status blocked
        break
    fi
    before=$(state "$n")
    if [ "$n" = "$last" ]; then tries=$((tries + 1)); else tries=1; last=$n; fi
    if [ "$tries" -gt 3 ]; then
        echo "agent-loop: ticket #$n has had three sessions without finishing; stopping."
        break
    fi

    log="$LOGS/$(date +%Y%m%dT%H%M%S)-t$(printf '%04d' "$n").jsonl"
    echo
    echo "=== $(date '+%F %T') ticket #$n (session $tries, effort $EFFORT): $before"
    claude -p "Work ticket #$n of this repo through the workflow in CLAUDE.md: plan, code, check and deliver it, or mark it blocked with your question. One ticket only; end the session when it is closed or blocked." \
        --effort "$EFFORT" \
        --permission-mode bypassPermissions \
        --output-format stream-json --verbose \
        < /dev/null | tee "$log" | show
    echo "=== $(date '+%F %T') ticket #$n now: $(state "$n")"
done
