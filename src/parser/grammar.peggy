Start
  = _ expr:Expression _ EOF { return expr }

Expression
  = OrExpression

OrExpression
  = head:AndExpression tail:(_ "OR" _ e:AndExpression { return e })*
    {
      return tail.length === 0 ? head : { type: 'or', children: [head, ...tail] }
    }

AndExpression
  = head:PrimaryExpression tail:(Connector e:PrimaryExpression { return e })*
    {
      return tail.length === 0 ? head : { type: 'and', children: [head, ...tail] }
    }

// AND is the default combinator between predicates, so it may be stated explicitly
// ("A AND B") or left implicit via juxtaposition ("A B") — either way requires whitespace.
Connector
  = _ "AND" _
  / [\t\n\r ]+

PrimaryExpression
  = "(" _ e:Expression _ ")" { return e }
  // "NOT" must be immediately followed by whitespace or "(" — otherwise it's just the
  // start of a field name (e.g. "NOTstatus:online" stays one field, not NOT + "status").
  // Binds tighter than AND/OR, so it only negates the next term/group; parenthesize to
  // negate more ("NOT (a b)" negates the whole group; "NOT a b" is "(NOT a) AND b").
  / "NOT" &[\t\n\r (] _ e:PrimaryExpression { return { type: 'not', child: e } }
  / Predicate

Predicate
  = field:Field ":" operator:Operator? value:Value
    {
      return {
        type: 'predicate',
        field,
        // No operator character written at all ("field:value") is the bare-colon
        // shorthand — kept distinct from an explicit "=" (see ast/types.ts).
        operator: operator ?? ':',
        value,
        position: location().start.offset + 1,
      }
    }
  // A bare value with no "field:" prefix searches the conventional "_all" attribute —
  // define it in `attributes` (typically as a multi-field attribute) to opt in.
  / value:QuotedValue
    {
      return {
        type: 'predicate',
        field: '_all',
        operator: ':',
        value,
        position: location().start.offset + 1,
      }
    }
  // Bare (unquoted) "AND"/"OR"/"NOT" are always reserved as keywords, even where they'd
  // otherwise be unambiguous (e.g. as the very first term) — quote them (`"AND"`) to
  // search for the literal word via the default field.
  / !ReservedWord value:UnquotedValue
    {
      return {
        type: 'predicate',
        field: '_all',
        operator: ':',
        value,
        position: location().start.offset + 1,
      }
    }

ReservedWord
  = ("AND" / "OR" / "NOT") ![a-zA-Z0-9_]

Field "field name"
  = chars:$([a-zA-Z_][a-zA-Z0-9_]*) { return chars }

Operator "operator"
  = ">=" { return '>=' }
  / "<=" { return '<=' }
  / "=" { return '=' }
  / ">" { return '>' }
  / "<" { return '<' }

Value "value"
  = QuotedValue
  / UnquotedValue

UnquotedValue
  = chars:$([^\t\n\r ()]+) { return chars }

// Double-quoted values may contain whitespace and parentheses. "\" escapes the
// following character (e.g. \" for a literal quote, \\ for a literal backslash).
QuotedValue "quoted value"
  = '"' chars:QuotedChar* '"' { return chars.join('') }

QuotedChar
  = "\\" char:. { return char }
  / !'"' char:. { return char }

_ "whitespace"
  = [\t\n\r ]*

EOF
  = !.
