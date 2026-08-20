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

Connector
  = _ "AND" _
  / [\t\n\r ]+

PrimaryExpression
  = "(" _ e:Expression _ ")" { return e }
  // Must be followed by whitespace/"(" — else it's a field name, e.g. "NOTstatus:online".
  / "NOT" &[\t\n\r (] _ e:PrimaryExpression { return { type: 'not', child: e } }
  // Shorthand for "NOT", only when attached with no space (else it's a literal "-" value).
  / "-" &[^\t\n\r ] e:PrimaryExpression { return { type: 'not', child: e } }
  / Predicate

Predicate
  // Only the bare-colon form can carry wildcard syntax — LiteralValue never unescapes
  // "\*" to a wildcard, since "*" isn't special with an explicit operator anyway.
  = field:Field ":" operator:Operator value:LiteralValue
    {
      return {
        type: 'predicate',
        field,
        operator,
        value,
        position: location().start.offset + 1,
      }
    }
  / field:Field ":" value:Value
    {
      return {
        type: 'predicate',
        field,
        operator: ':',
        value,
        position: location().start.offset + 1,
      }
    }
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
  = chars:UnquotedChar+ { return chars.join('') }

UnquotedChar
  = "\\*" { return '\\*' }
  / "\\\\" { return '\\\\' }
  / "\\" char:[^\t\n\r ()] { return char }
  / char:[^\t\n\r ()] { return char }

QuotedValue "quoted value"
  = '"' chars:QuotedChar* '"' { return chars.join('') }

QuotedChar
  = "\\*" { return '\\*' }
  / "\\\\" { return '\\\\' }
  / "\\" char:. { return char }
  / !'"' char:. { return char }

LiteralValue "value"
  = QuotedLiteralValue
  / UnquotedLiteralValue

UnquotedLiteralValue
  = chars:UnquotedLiteralChar+ { return chars.join('') }

UnquotedLiteralChar
  = "\\" char:[^\t\n\r ()] { return char }
  / char:[^\t\n\r ()] { return char }

QuotedLiteralValue "quoted value"
  = '"' chars:QuotedLiteralChar* '"' { return chars.join('') }

QuotedLiteralChar
  = "\\" char:. { return char }
  / !'"' char:. { return char }

_ "whitespace"
  = [\t\n\r ]*

EOF
  = !.
