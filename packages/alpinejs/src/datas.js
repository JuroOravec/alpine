
let datas = {}

export function data(name, callback) {
    datas[name] = callback
}

export function injectDataProviders(obj, context) {
    Object.entries(datas).forEach(([name, callback]) => {
        Object.defineProperty(obj, name, {
            value: callback.bind(context),
            enumerable: false,
        })
    })

    return obj
}
