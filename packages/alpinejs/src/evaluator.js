import { closestDataStack, mergeProxies, mergeProxies2 } from './scope'
import { injectMagics } from './magics'
import { tryCatch, handleError } from './utils/error'

/** @typedef { (...args: any[]) => Promise<any> } AsyncFunc */
/** @typedef { (receiver: (result: any) => void, extras: { scope: Record, params: any[], context: Record }) => void } EvaluateCallback */

let shouldAutoEvaluateFunctions = true

export function dontAutoEvaluateFunctions(callback) {
    let cache = shouldAutoEvaluateFunctions

    shouldAutoEvaluateFunctions = false

    let result = callback()

    shouldAutoEvaluateFunctions = cache

    return result
}

/**
 * @param {HTMLElement} el 
 * @param {*} expression 
 * @param {*} extras 
 * @returns {any}
 */
export function evaluate(el, expression, extras = {}) {
    let result

    evaluateLater(el, expression)(value => result = value, extras)

    return result
}

/**
 * @param {HTMLElement} el
 * @param {string | ((...args: any[]) => any)} expression
 * @returns {EvaluateCallback}
 */
export function evaluateLater(el, expression) {
    return theEvaluatorFunction(el, expression)
}

let theEvaluatorFunction = normalEvaluator

export function setEvaluator(newEvaluator) {
    theEvaluatorFunction = newEvaluator
}

// TODO - PART OF LAZY_SCOPE_FETCH
// Q: Does evaluator runs for HTML elements without `x-...` directives?
/**
 * @param {HTMLElement} el
 * @param {string | ((...args: any[]) => any)} expression
 */
export function normalEvaluator(el, expression) {
    const overriddenMagics = injectMagics({}, el)

    let evaluator = (typeof expression === 'function')
        ? generateEvaluatorFromFunction(el, expression, overriddenMagics)
        : generateEvaluatorFromString(el, expression, overriddenMagics)

    return tryCatch.bind(null, el, expression, evaluator)
}

// TODO - PART OF LAZY_SCOPE_FETCH
/**
 * @param {HTMLElement} el
 * @param {(...args: any[]) => any} func
 * @param {object} extraData
 */
export function generateEvaluatorFromFunction(el, func, extraData) {
    return (receiver = () => {}, { scope = {}, params = [], context } = {}) => {
        // NOTE: MERGED PROXY MUTABLE FROM INSIDE `func` as `this.x = y`.
        let result = func.apply(mergeProxies2(el, [scope, extraData]), params)

        runIfTypeOfFunction(receiver, result)
    }
}

/** @type {Record<string, AsyncFunc | Promise>} */
let evaluatorMemo = {}

let AsyncFunction = Object.getPrototypeOf(async function(){}).constructor

let ifExpressionRegex = /^[\n\s]*if.*\(.*\)/;
let letConstExpressionRegex = /^(let|const)\s/;

// TODO - MOVE REGEX OUT!
/**
 * @param {string} expression
 * @param {HTMLElement} el
 * @returns {AsyncFunc | Promise}
 */
function generateFunctionFromString(expression, el) {
    expression = expression.trim();
    if (evaluatorMemo[expression]) {
        return evaluatorMemo[expression]
    }

    // Some expressions that are useful in Alpine are not valid as the right side of an expression.
    // Here we'll detect if the expression isn't valid for an assignment and wrap it in a self-
    // calling function so that we don't throw an error AND a "return" statement can b e used.
    let rightSideSafeExpression = 0
        // Support expressions starting with "if" statements like: "if (...) doSomething()"
        || expression.match(ifExpressionRegex)
        // Support expressions starting with "let/const" like: "let foo = 'bar'"
        || expression.match(letConstExpressionRegex)
            ? `(async()=>{ ${expression} })()`
            : expression

    // TODO - PART OF LAZY_SCOPE_FETCH
    /**
     * @returns {Promise | ((...args: any[]) -> Promise)}
     */
    const safeAsyncFunction = () => {
        try {
            let func = new AsyncFunction(
                // ["__self", "scope"],
                // // TODO - Example of how to hack AlpineJS - '1; } console.log(scope); debugger; {'
                // `with (scope) { __self.result = ${rightSideSafeExpression} }; __self.finished = true; return __self.result;`

                // TODO - PART OF LAZY_SCOPE_FETCH
                ["__self", "scope"],
                // NOTE: `__self` is an object that we defined.
                `with (scope) { __self.result = ${rightSideSafeExpression} }; __self.finished = true; return __self.result;`
            )

            Object.defineProperty(func, "name", {
                value: `[Alpine] ${expression}`,
            })

            return func
        } catch ( error ) {
            handleError( error, el, expression )
            return Promise.resolve()
        }
    }
    let func = safeAsyncFunction()

    evaluatorMemo[expression] = func

    return func
}

// TODO - I THINK THIS COULD BE OPTIMIZED TOO, THO DUNNO HOW.
// TODO - PART OF LAZY_SCOPE_FETCH
/**
 * @param {HTMLElement} el
 * @param {string} expression
 * @param {object} extraData
 */
function generateEvaluatorFromString(el, expression, extraData) {
    let func = generateFunctionFromString(expression, el)

    return (receiver = () => {}, { scope = {}, params = [], context } = {}) => {
        // func.result = undefined
        // func.finished = false

        // This is an object to which the generated async function can write
        // it can be accessed from within the expression under `__self`.
        const resultsObj = { result: undefined, finished: false };
        
        let completeScope = mergeProxies2(el, [ scope, extraData ])
        
        // Run the function.
        if (typeof func === 'function' ) {
            let promise = func.call(context, resultsObj, completeScope).catch((error) => handleError(error, el, expression))

            // Check if the function ran synchronously,
            if (resultsObj.finished) {
                // Return the immediate result.
                runIfTypeOfFunction(receiver, resultsObj.result, completeScope, params, el)

                // TODO - NOT NEEDED ANYMORE!!!
                // Once the function has run, we clear func.result so we don't create
                // memory leaks. func is stored in the evaluatorMemo and every time
                // it runs, it assigns the evaluated expression to result which could
                // potentially store a reference to the DOM element that will be removed later on.
                // func.result = undefined
            } else {
                // If not, return the result when the promise resolves.
                promise.then(result => {
                    runIfTypeOfFunction(receiver, result, completeScope, params, el)
                }).catch( error => handleError( error, el, expression ) )
                .finally( () => resultsObj.result = undefined )
            }
        }
    }
}

export function runIfTypeOfFunction(receiver, value, scope, params, el) {
    if (shouldAutoEvaluateFunctions && typeof value === 'function') {
        // NOTE: SCOPE MAY BE MUTATED HERE INSIDE `value` FN as `this.x = y`
        let result = value.apply(scope, params)

        if (result instanceof Promise) {
            result.then(i => runIfTypeOfFunction(receiver, i, scope, params)).catch( error => handleError( error, el, value ) )
        } else {
            receiver(result)
        }
    } else if (typeof value === 'object' && value instanceof Promise) {
        value.then(i => receiver(i))
    } else {
        receiver(value)
    }
}
