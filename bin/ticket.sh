#!/bin/bash
# =============================================================================
# bin/ticket.sh — local file-based ticket system CLI
# =============================================================================
#
# Tickets live as one markdown file per ticket under tickets/, named
# NNNN-slug.md (4-digit zero-padded number), committed with the code.
# Metadata is YAML frontmatter; string values are JSON-encoded (valid YAML
# flow scalars) so titles with colons/quotes round-trip safely. The body is
# the ticket description; comments append under a `## Comments` heading.
#
# Numbering starts at #1. Tickets of the AIC framework are cited "AIC #N",
# jqstar's as "jqstar 00NN".
#
# Subcommands:
#   list    [--status S|all|closed] [--type T] [--limit N]
#   show    <n>              print the ticket file (path header + content)
#   path    <n>              print the ticket file path
#   create  --title T --type TY [--tags a,b] [--phase P] [--description D]
#            (description also accepted on stdin when --description absent
#             and stdin is not a TTY)
#   update  <n> [--status S] [--phase P] [--type TY] [--title T]
#            (phases: plan, code, check, docs; a non-terminal status drops `closed`)
#   close   <n> [--as done|won-t-fix|abandoned|closed] [--note TEXT]
#   comment <n> [--body TEXT]   (body from stdin when --body absent)
#   next    [--type T]       lowest-numbered open ticket
#   count   [--status S|all|closed]
#
# Exit: 0 success, 1 usage/not-found, 2 environment error.
# =============================================================================

set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TICKETS_DIR="${PROJECT_ROOT}/tickets"

TERMINAL_STATUSES="done won-t-fix abandoned closed"
KNOWN_STATUSES="open in-progress in-review blocked done won-t-fix abandoned closed"
KNOWN_TYPES="feature bug chore spike docs"
KNOWN_PHASES="plan code check docs"

usage() {
    sed -n '/^# Subcommands/,/^# Exit/p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
}

die() {
    echo "ticket.sh: $*" >&2
    exit 1
}

require_env() {
    command -v jq >/dev/null 2>&1 || { echo "ticket.sh: jq is required" >&2; exit 2; }
    [ -d "$TICKETS_DIR" ] || { echo "ticket.sh: ${TICKETS_DIR} not found" >&2; exit 2; }
}

# Fail with a usage error when an option arrives without its value. Call as
# `need_value "$@"` from an option loop, so $1 is the option and $2 its value.
need_value() {
    [ $# -ge 2 ] || die "$1 needs a value"
}

# Write a rewritten file back over the original in place, so the ticket keeps
# its mode (a plain mv would carry mktemp's 0600 over).
replace_file() {
    cat "$1" > "$2"
    rm -f "$1"
}

now_iso() {
    date -u +%Y-%m-%dT%H:%M:%SZ
}

# Resolve a ticket number to its file path. Accepts "42", "#42", "0042".
ticket_file() {
    local n pad matches
    n="${1#\#}"
    case "$n" in
        ''|*[!0-9]*) die "invalid ticket number: $1" ;;
    esac
    pad=$(printf '%04d' "$((10#$n))")
    matches=$(find "$TICKETS_DIR" -maxdepth 1 -name "${pad}-*.md" -type f | awk 'NR == 1')
    [ -n "$matches" ] || die "ticket #${n} not found"
    echo "$matches"
}

# Read one frontmatter value (raw, still JSON-encoded when it is a string).
# Scans only the head of the file: line 1 must be ---, stops at the next ---.
fm_raw() {
    local file="$1" key="$2"
    awk -v key="$key" '
        NR == 1 { next }
        /^---$/ { exit }
        index($0, key ": ") == 1 { print substr($0, length(key) + 3); exit }
    ' "$file"
}

# Read a frontmatter value, JSON-decoding when it is a quoted string.
fm_get() {
    local raw
    raw=$(fm_raw "$1" "$2")
    case "$raw" in
        '"'*) printf '%s' "$raw" | jq -r . ;;
        *)    printf '%s\n' "$raw" ;;
    esac
}

# Replace (or insert before the closing ---) a frontmatter key with a raw value.
fm_set_raw() {
    local file="$1" key="$2" value="$3" tmp
    tmp=$(mktemp)
    # The value goes in through the environment: awk -v would expand the
    # backslash escapes of a JSON-encoded string.
    FM_VALUE="$value" awk -v key="$key" '
        BEGIN { in_fm = 0; done = 0; value = ENVIRON["FM_VALUE"] }
        NR == 1 && /^---$/ { in_fm = 1; print; next }
        in_fm && /^---$/ {
            if (!done) { print key ": " value; done = 1 }
            in_fm = 0; print; next
        }
        in_fm && index($0, key ": ") == 1 && !done {
            print key ": " value; done = 1; next
        }
        { print }
    ' "$file" > "$tmp"
    replace_file "$tmp" "$file"
}

# Remove a frontmatter key, when present.
fm_del() {
    local file="$1" key="$2" tmp
    tmp=$(mktemp)
    awk -v key="$key" '
        NR == 1 && /^---$/ { in_fm = 1; print; next }
        in_fm && /^---$/ { in_fm = 0; print; next }
        in_fm && index($0, key ": ") == 1 { next }
        { print }
    ' "$file" > "$tmp"
    replace_file "$tmp" "$file"
}

fm_set_string() {
    fm_set_raw "$1" "$2" "$(jq -cn --arg v "$3" '$v')"
}

validate_status() {
    local s
    for s in $KNOWN_STATUSES; do
        [ "$s" = "$1" ] && return 0
    done
    die "unknown status '$1' (expected one of: ${KNOWN_STATUSES})"
}

validate_type() {
    local t
    for t in $KNOWN_TYPES; do
        [ "$t" = "$1" ] && return 0
    done
    die "unknown type '$1' (expected one of: ${KNOWN_TYPES})"
}

validate_phase() {
    local p
    for p in $KNOWN_PHASES; do
        [ "$p" = "$1" ] && return 0
    done
    die "unknown phase '$1' (expected one of: ${KNOWN_PHASES})"
}

is_terminal() {
    local s
    for s in $TERMINAL_STATUSES; do
        [ "$s" = "$1" ] && return 0
    done
    return 1
}

# Emit "number<TAB>status<TAB>type<TAB>title" for every ticket, ascending.
# Single awk pass; reads only each file's frontmatter head (nextfile after
# the closing ---). Titles are display-decoded (quotes + backslash escapes).
scan_all() {
    find "$TICKETS_DIR" -maxdepth 1 -name '[0-9][0-9][0-9][0-9]-*.md' -type f -print0 \
        | sort -z \
        | xargs -0 -r awk '
            FNR == 1 { n = ""; s = ""; t = ""; ti = ""; next }
            /^---$/ {
                printf "%s\t%s\t%s\t%s\n", n, s, t, ti
                nextfile
            }
            index($0, "number: ") == 1 { n = substr($0, 9); next }
            index($0, "status: ") == 1 { s = substr($0, 9); next }
            index($0, "type: ") == 1   { t = substr($0, 7); next }
            index($0, "title: ") == 1 {
                ti = substr($0, 8)
                if (ti ~ /^".*"$/) {
                    ti = substr(ti, 2, length(ti) - 2)
                    gsub(/\\"/, "\"", ti)
                    gsub(/\\\\/, "\\", ti)
                }
                next
            }
        ' | sort -n
}

# Filter scan_all rows by a status selector: open bucket (default) / closed
# bucket / all / exact status. Reads rows on stdin.
filter_status() {
    local selector="$1"
    case "$selector" in
        all)    cat ;;
        open-bucket|'')
                awk -F'\t' '$2 == "open" || $2 == "in-progress" || $2 == "in-review" || $2 == "blocked"' ;;
        closed|closed-bucket)
                awk -F'\t' '$2 == "done" || $2 == "won-t-fix" || $2 == "abandoned" || $2 == "closed"' ;;
        *)      awk -F'\t' -v s="$selector" '$2 == s' ;;
    esac
}

filter_type() {
    local t="$1"
    if [ -n "$t" ]; then
        awk -F'\t' -v t="$t" '$3 == t'
    else
        cat
    fi
}

cmd_list() {
    local status="" type="" limit=0
    while [ $# -gt 0 ]; do
        case "$1" in
            --status) need_value "$@"; status="$2"; shift 2 ;;
            --type)   need_value "$@"; type="$2"; shift 2 ;;
            --limit)  need_value "$@"; limit="$2"; shift 2 ;;
            *) die "list: unknown option $1" ;;
        esac
    done
    case "$limit" in
        ''|*[!0-9]*) die "list: --limit needs a number, got '${limit}'" ;;
    esac
    local rows
    rows=$(scan_all | filter_status "$status" | filter_type "$type")
    if [ "$limit" -gt 0 ]; then
        rows=$(printf '%s\n' "$rows" | tail -n "$limit")
    fi
    [ -n "$rows" ] || { echo "(no tickets match)"; return 0; }
    printf '%s\n' "$rows" | awk -F'\t' '{ printf "#%04d  %-11s %-8s %s\n", $1, $2, $3, $4 }'
}

cmd_show() {
    [ $# -ge 1 ] || usage
    local file
    file=$(ticket_file "$1")
    echo "── ${file#"${PROJECT_ROOT}"/} ──"
    cat "$file"
}

cmd_path() {
    [ $# -ge 1 ] || usage
    ticket_file "$1"
}

slugify() {
    printf '%s' "$1" \
        | tr '[:upper:]' '[:lower:]' \
        | sed -e 's/[^a-z0-9]\{1,\}/-/g' -e 's/^-\{1,\}//' -e 's/-\{1,\}$//' \
        | cut -c1-60
}

next_number() {
    local max
    max=$(find "$TICKETS_DIR" -maxdepth 1 -name '[0-9][0-9][0-9][0-9]-*.md' -type f \
        | sed -e 's|.*/||' -e 's|^\([0-9]\{4\}\)-.*|\1|' | sort -n | tail -1)
    [ -n "$max" ] || max=0
    echo "$((10#$max + 1))"
}

cmd_create() {
    local title="" type="" tags="" phase="" description=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --title)       need_value "$@"; title="$2"; shift 2 ;;
            --type)        need_value "$@"; type="$2"; shift 2 ;;
            --tags)        need_value "$@"; tags="$2"; shift 2 ;;
            --phase)       need_value "$@"; phase="$2"; shift 2 ;;
            --description) need_value "$@"; description="$2"; shift 2 ;;
            *) die "create: unknown option $1" ;;
        esac
    done
    [ -n "$title" ] || die "create: --title is required"
    [ -n "$type" ] || die "create: --type is required"
    validate_type "$type"
    [ -z "$phase" ] || validate_phase "$phase"
    if [ -z "$description" ] && [ ! -t 0 ]; then
        description=$(cat)
    fi

    local n pad slug file ts tags_json
    n=$(next_number)
    pad=$(printf '%04d' "$n")
    slug=$(slugify "$title")
    [ -n "$slug" ] || slug="ticket"
    file="${TICKETS_DIR}/${pad}-${slug}.md"
    ts=$(now_iso)
    tags_json=$(printf '%s' "$tags" | jq -cR 'split(",") | map(gsub("^\\s+|\\s+$"; "")) | map(select(length > 0))')

    {
        echo '---'
        echo "number: ${n}"
        echo "uuid: $(cat /proc/sys/kernel/random/uuid)"
        echo "title: $(jq -cn --arg v "$title" '$v')"
        echo "type: ${type}"
        echo "status: open"
        [ -n "$phase" ] && echo "phase: $(jq -cn --arg v "$phase" '$v')"
        echo "tags: ${tags_json}"
        echo "created: ${ts}"
        echo "updated: ${ts}"
        echo '---'
        echo
        if [ -n "$description" ]; then
            printf '%s\n' "$description"
        fi
    } > "$file"

    echo "created #${n}: ${file#"${PROJECT_ROOT}"/}"
}

cmd_update() {
    [ $# -ge 1 ] || usage
    local file
    file=$(ticket_file "$1")
    shift
    [ $# -gt 0 ] || die "update: nothing to change"
    # Validate every option before writing any, so a bad one leaves the
    # ticket untouched instead of half-updated.
    local status="" phase="" type="" title="" has_title=0
    while [ $# -gt 0 ]; do
        case "$1" in
            --status) need_value "$@"; validate_status "$2"; status="$2"; shift 2 ;;
            --phase)  need_value "$@"; validate_phase "$2"; phase="$2"; shift 2 ;;
            --type)   need_value "$@"; validate_type "$2"; type="$2"; shift 2 ;;
            --title)  need_value "$@"; title="$2"; has_title=1; shift 2 ;;
            *) die "update: unknown option $1" ;;
        esac
    done
    if [ -n "$status" ]; then
        fm_set_raw "$file" status "$status"
        # A reopened ticket drops the timestamp of its last close.
        is_terminal "$status" || fm_del "$file" closed
    fi
    [ -z "$phase" ] || fm_set_string "$file" phase "$phase"
    [ -z "$type" ] || fm_set_raw "$file" type "$type"
    [ "$has_title" -eq 0 ] || fm_set_string "$file" title "$title"
    fm_set_raw "$file" updated "$(now_iso)"
    echo "updated: ${file#"${PROJECT_ROOT}"/}"
}

append_comment() {
    local file="$1" body="$2" ts
    ts=$(now_iso)
    if ! grep -q '^## Comments$' "$file"; then
        printf '\n## Comments\n' >> "$file"
    fi
    printf '\n### %s\n\n%s\n' "$ts" "$body" >> "$file"
}

cmd_comment() {
    [ $# -ge 1 ] || usage
    local file body=""
    file=$(ticket_file "$1")
    shift
    while [ $# -gt 0 ]; do
        case "$1" in
            --body) need_value "$@"; body="$2"; shift 2 ;;
            *) die "comment: unknown option $1" ;;
        esac
    done
    if [ -z "$body" ]; then
        [ ! -t 0 ] || die "comment: provide --body or pipe the body on stdin"
        body=$(cat)
    fi
    [ -n "$body" ] || die "comment: empty body"
    append_comment "$file" "$body"
    fm_set_raw "$file" updated "$(now_iso)"
    echo "commented: ${file#"${PROJECT_ROOT}"/}"
}

cmd_close() {
    [ $# -ge 1 ] || usage
    local file final="done" note=""
    file=$(ticket_file "$1")
    shift
    while [ $# -gt 0 ]; do
        case "$1" in
            --as)   need_value "$@"; final="$2"; shift 2 ;;
            --note) need_value "$@"; note="$2"; shift 2 ;;
            *) die "close: unknown option $1" ;;
        esac
    done
    is_terminal "$final" || die "close: '${final}' is not terminal (${TERMINAL_STATUSES})"
    fm_set_raw "$file" status "$final"
    fm_set_raw "$file" closed "$(now_iso)"
    fm_set_raw "$file" updated "$(now_iso)"
    if [ -n "$note" ]; then
        append_comment "$file" "$note"
    fi
    echo "closed as ${final}: ${file#"${PROJECT_ROOT}"/}"
}

cmd_next() {
    local type=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --type) need_value "$@"; type="$2"; shift 2 ;;
            *) die "next: unknown option $1" ;;
        esac
    done
    local row
    row=$(scan_all | filter_status open | filter_type "$type" | awk 'NR == 1')
    [ -n "$row" ] || { echo "(no open tickets)"; return 0; }
    printf '%s\n' "$row" | awk -F'\t' '{ printf "#%04d  %-11s %-8s %s\n", $1, $2, $3, $4 }'
}

cmd_count() {
    local status=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --status) need_value "$@"; status="$2"; shift 2 ;;
            *) die "count: unknown option $1" ;;
        esac
    done
    scan_all | filter_status "$status" | wc -l
}

[ $# -ge 1 ] || usage
COMMAND="$1"
shift

require_env

case "$COMMAND" in
    list)    cmd_list "$@" ;;
    show)    cmd_show "$@" ;;
    path)    cmd_path "$@" ;;
    create)  cmd_create "$@" ;;
    update)  cmd_update "$@" ;;
    close)   cmd_close "$@" ;;
    comment) cmd_comment "$@" ;;
    next)    cmd_next "$@" ;;
    count)   cmd_count "$@" ;;
    *) usage ;;
esac
