import { directive, prefix } from "../directives";
import { skipDuringClone } from "../clone";


directive('init', skipDuringClone((el, { expression }, { evaluate }) => {
    if (typeof expression === 'string') {
        return !! expression.trim() && evaluate(expression, {}, false)
    }

    return evaluate(expression, {}, false)
}))
