const app  = (await eval('import("../../scripts/app.js")')).app // call native import
const api  = (await eval('import("../../scripts/api.js")')).api // call native import

export {
    app,
    api,
}