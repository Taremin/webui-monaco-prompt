import { editor } from 'monaco-editor'
// @ts-ignore
import { LinkedList } from 'monaco-editor/esm/vs/base/common/linkedList'
// @ts-ignore
import { MenuId, MenuRegistry } from 'monaco-editor/esm/vs/platform/actions/common/actions'

type ActionDescriptor = {
    run: (editor: editor.IStandaloneCodeEditor) => void
    label: string
    id: string
    order: number
    groupId: string
    commandOptions?: object
}

interface ActionsPartialDescripter extends Omit<ActionDescriptor, 'order' | 'groupId'> {
    order?: ActionDescriptor["order"]
    groupId?: ActionDescriptor["groupId"]
}

type SubMenuDescriptor = {
    title: string
    context: string
    group: string
    order: number
    actions: ActionsPartialDescripter[]
}

const addActionWithSubMenu = function(
    editor: editor.IStandaloneCodeEditor,
    descriptor: SubMenuDescriptor
) {
    const submenu = new MenuId(descriptor.context)
    const list = new LinkedList()

    MenuRegistry._menuItems.set(submenu, list);

    for (let i = 0, il = descriptor.actions.length; i < il; ++i) {
        const action = descriptor.actions[i];

        if (typeof action.order !== "number") {
            action.order = i
        }
        if (!action.groupId) {
            action.groupId = descriptor.group
        }

        addActionWithCommandOption(editor, action as ActionDescriptor)

        const actionId = editor.getSupportedActions().find(a => a.label === action.label && a.id.endsWith(action.id))!.id
        const items = MenuRegistry._menuItems.get(MenuId.EditorContext) as LinkedList;
        const item = popItem(items, actionId);
        if (item) {
            list.push(item);
        }
    }

    MenuRegistry._menuItems.get(MenuId.EditorContext).push({
        group: descriptor.group,
        order: descriptor.order,
        submenu: submenu,
        title: descriptor.title,
    });
}

const addActionWithCommandOption = function(
    editor: editor.IStandaloneCodeEditor,
    action: ActionDescriptor
) {
    const retval = editor.addAction({
        id: action.id,
        label: action.label,
        run: action.run,
        contextMenuOrder: action.order,
        contextMenuGroupId: action.groupId,
    })

    const actionId = editor.getSupportedActions().find(a => a.label === action.label && a.id.endsWith(action.id))!.id

    const items = MenuRegistry._menuItems.get(MenuId.EditorContext) as LinkedList
    const item = findItem(items, actionId)

    if (item && item.element && item.element.command && action.commandOptions) {
        Object.assign(item.element.command, action.commandOptions)
    }

    return retval
}

const popItem = (items: LinkedList, id: string): any => {
    const node =  findItem(items, id)
    if (node) {
        items._remove(node)
        return node.element
    }
    return null
}

const findItem = (items: LinkedList, id: string): any => {
    let node = items._first;
    do {
        if (node.element?.command?.id === id) {
            return node
        }
        node = node.next
    } while (node !== void 0)
    return null
}

export {
    addActionWithSubMenu,
    addActionWithCommandOption,
}