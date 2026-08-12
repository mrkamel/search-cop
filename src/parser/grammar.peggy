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
  = head:PrimaryExpression tail:(_ "AND" _ e:PrimaryExpression { return e })*
    {
      return tail.length === 0 ? head : { type: 'and', children: [head, ...tail] }
    }

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
  = chars:$([^\t\n\r ()]+) { return chars }

_ "whitespace"
  = [\t\n\r ]*

EOF
  = !.
