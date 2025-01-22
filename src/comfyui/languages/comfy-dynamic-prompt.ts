import {languages} from 'monaco-editor/esm/vs/editor/editor.api'
import {conf as baseConf, language as baseLanguage} from '../../languages/sd-dynamic-prompt'
import { conf as comfyConf, comments, whitespace} from './comfy-prompt'

const conf: languages.LanguageConfiguration = Object.assign({}, baseConf, {
	comments: Object.assign({}, baseConf.comments, comfyConf.comments),
})

const language: languages.IMonarchLanguage = Object.assign({}, baseLanguage, {
	brackets: baseLanguage.brackets!.concat([
		{ open: '{', close: '}', token: 'delimiter.curly' },
	]),

	tokenizer: Object.assign({}, baseLanguage.tokenizer, {
		whitespace: baseLanguage.tokenizer.whitespace.concat(whitespace),
        comment: comments,
	}),
})

export {
	conf,
	language,
}
