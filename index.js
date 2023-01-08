const assert = require('assert')
const acorn = require('acorn')
const astring = require('astring')
const scan = require('scope-analyzer')
const multisplice = require('multisplice')

module.exports = function unpack (source, opts) {
  const ast = typeof source === 'object' && typeof source.type === 'string'
    ? source
    : acorn.parse(source, { ecmaVersion: 2019 })

  if (opts && opts.source) {
    source = opts.source
  }

  if (source && Buffer.isBuffer(source)) {
    source = source.toString()
  }

  // nullify source if a parsed ast was given in the first parameter
  if (ast === source) {
    source = null
  }

  assert(!source || typeof source === 'string', 'webpack-unpack: source must be a string or Buffer')

  let meta = unpackRuntimePrelude(ast)
  if (!meta) meta = unpackJsonpPrelude(ast)
  if (!meta) return

  const entryId = meta.entryId
  const factories = meta.factories

  if (!factories.every(isFunctionOrEmpty)) {
    return
  }

  const modules = []
  for (let i = 0; i < factories.length; i++) {
    const factory = factories[i]
    if (factory.factory === null) continue

    scan.crawl(factory.factory)
    // If source is available, rewrite the require,exports,module var names in place
    // Else, generate a string afterwards.
    const range = getModuleRange(factory.factory.body)
    let moduleSource = rewriteMagicIdentifiers(
      factory.factory,
      source ? source.slice(range.start, range.end) : null,
      range.start
    )
    if (!moduleSource) {
      moduleSource = astring.generate({
        type: 'Program',
        body: factory.factory.body.body
      })
    }

    const deps = getDependencies(factory.factory)

    modules.push({
      id: factory.index,
      source: moduleSource,
      deps: deps,
      entry: factory.index === entryId
    })
  }

  return modules
}

function unpackRuntimePrelude (ast) {
  // !(prelude)(factories)
  if (ast.body[0].type !== 'ExpressionStatement' ||
      ast.body[0].expression.type !== 'UnaryExpression' ||
      ast.body[0].expression.argument.type !== 'CallExpression') {
    return
  }

  // prelude = (function(t){})
  const outer = ast.body[0].expression.argument
  if (outer.callee.type !== 'FunctionExpression' || outer.callee.params.length !== 1) {
    return
  }
  const prelude = outer.callee.body

  // Find the entry point require call.
  let entryNode = find(prelude.body.slice().reverse(), function (node) {
    if (node.type !== 'ExpressionStatement') return false
    node = node.expression
    if (node.type === 'SequenceExpression') {
      const exprs = node.expressions
      node = exprs[exprs.length - 1]
    }
    return node.type === 'CallExpression' &&
      node.arguments.length === 1 &&
      node.arguments[0].type === 'AssignmentExpression'
  })
  if (entryNode) {
    entryNode = entryNode.expression
    if (entryNode.type === 'SequenceExpression') {
      entryNode = entryNode.expressions[entryNode.expressions.length - 1]
    }
    entryNode = entryNode.arguments[0].right
  }
  const entryId = entryNode ? entryNode.value : null

  // factories = [function(){}]
  if (outer.arguments.length !== 1 ||
      (outer.arguments[0].type !== 'ArrayExpression' && outer.arguments[0].type !== 'ObjectExpression')) {
    return
  }
  const factories = getFactories(outer.arguments[0])

  return {
    factories: factories,
    entryId: entryId
  }
}

function unpackJsonpPrelude (ast) {
  // (prelude).push(factories)
  if (ast.body[0].type !== 'ExpressionStatement' ||
      ast.body[0].expression.type !== 'CallExpression' ||
      ast.body[0].expression.callee.type !== 'MemberExpression') {
    return
  }

  const callee = ast.body[0].expression.callee
  // (webpackJsonp = webpackJsonp || []).push
  if (callee.computed || callee.property.name !== 'push') return
  if (callee.object.type !== 'AssignmentExpression') return

  const args = ast.body[0].expression.arguments
  // ([ [bundleIds], [factories])
  if (args.length !== 1) return
  if (args[0].type !== 'ArrayExpression') return
  if (args[0].elements[0].type !== 'ArrayExpression') return
  if (args[0].elements[1].type !== 'ArrayExpression' && args[0].elements[1].type !== 'ObjectExpression') return

  const factories = getFactories(args[0].elements[1])

  return {
    factories: factories,
    entryId: undefined
  }
}

function isFunctionOrEmpty (node) {
  return node.factory === null || node.factory.type === 'FunctionExpression'
}

function getModuleRange (body) {
  if (body.body.length === 0) {
    // exclude {} braces
    return { start: body.start + 1, end: body.end - 1 }
  }
  return {
    start: body.body[0].start,
    end: body.body[body.body.length - 1].end
  }
}

function rewriteMagicIdentifiers (moduleWrapper, source, offset) {
  const magicBindings = moduleWrapper.params.map(scan.getBinding)
  const magicNames = ['module', 'exports', 'require']
  const edit = source ? multisplice(source) : null

  magicBindings.forEach(function (binding, i) {
    const name = magicNames[i]
    binding.getReferences().forEach(function (ref) {
      if (ref === binding.definition) return

      ref.name = name
      if (edit) edit.splice(ref.start - offset, ref.end - offset, name)
    })
  })

  return edit ? edit.toString() : null
}

function getDependencies (moduleWrapper) {
  const deps = {}
  if (moduleWrapper.params.length < 3) return deps

  const req = scan.getBinding(moduleWrapper.params[2])
  req.getReferences().forEach(function (ref) {
    if (ref.parent.type === 'CallExpression' && ref.parent.callee === ref && ref.parent.arguments[0].type === 'Literal') {
      deps[ref.parent.arguments[0].value] = ref.parent.arguments[0].value
    }
  })

  return deps
}

function find (arr, fn) {
  for (let i = 0; i < arr.length; i++) {
    if (fn(arr[i])) return arr[i]
  }
}

function getFactories (node) {
  if (node.type === 'ArrayExpression') {
    return node.elements.map(function (factory, index) {
      return { factory: factory, index: index }
    })
  }
  if (node.type === 'ObjectExpression') {
    return node.properties.map(function (prop) {
      let index
      if (prop.key.type === 'Literal') {
        index = prop.key.value
      } else if (prop.key.type === 'Identifier') {
        index = prop.key.name
      }
      return { factory: prop.value, index: index }
    })
  }
  return []
}
