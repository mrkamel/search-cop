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
  / Predicate

Predicate
  = field:Field ":" operator:Operator? value:Value
    {
      return {
        type: 'predicate',
        field,
        operator: operator ?? '=',
        value,
        position: location().start.offset + 1,
      }
    }

Field "field name"
  = chars:$([a-zA-Z_][a-zA-Z0-9_]*) { return chars }

Operator "operator"
  = "!=" { return '!=' }
  / ">=" { return '>=' }
  / "<=" { return '<=' }
  / "=" { return '=' }
  / ">" { return '>' }
  / "<" { return '<' }

Value "value"
  = QuotedValue
  / chars:$([^\t\n\r ()]+) { return chars }

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
