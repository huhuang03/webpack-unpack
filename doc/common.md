packaged source:
```js
(()=>{var o,t={993:(o,t)=>{t.test=function(o){console.log(o)},t.boop="beep"}},e={};function r(o){var n=e[o];if(void 0!==n)return n.exports;var a=e[o]={exports:{}};return t[o](a,a.exports,r),a.exports}o=r(Object(function(){var o=new Error("Cannot find module 'path'");throw o.code="MODULE_NOT_FOUND",o}())),r(993).test(o.join("whatever","lol"))})()
```

pretty:
```js
(() => {
    var o, t = {
            993: (o, t) => {
                t.test = function(o) {
                    console.log(o)
                }, t.boop = "beep"
            }
        },
        e = {};

    function r(o) {
        var n = e[o];
        if (void 0 !== n) return n.exports;
        var a = e[o] = {
            exports: {}
        };
        return t[o](a, a.exports, r), a.exports
    }
    o = r(Object(function() {
        var o = new Error("Cannot find module 'path'");
        throw o.code = "MODULE_NOT_FOUND", o
    }())), r(993).test(o.join("whatever", "lol"))
})()
```

ast:
```
ast: Node {
  type: 'Program',
    start: 0,
    end: 362,
    body: [
        Node {
          type: 'ExpressionStatement',
          start: 0,
          end: 362,
          expression: [Node]
        }
      ],
```
