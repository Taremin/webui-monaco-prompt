import {languages} from 'monaco-editor/esm/vs/editor/editor.api'
import {conf as baseConf, language as baseLanguage} from './sd-prompt'

const conf: languages.LanguageConfiguration = Object.assign({}, baseConf, {
	comments: Object.assign({}, baseConf.comments, {
		lineComment: '#',
	}),
	brackets: baseConf.brackets!.concat([
		['{', '}'],
	]),
	autoClosingPairs: baseConf.autoClosingPairs!.concat([
		{ open: '{', close: '}' },
	]),
	surroundingPairs: baseConf.surroundingPairs!.concat([
		{ open: '{', close: '}' },
	]),
})

const language: languages.IMonarchLanguage = Object.assign({}, baseLanguage, {
	brackets: baseLanguage.brackets!.concat([
		{ open: '{', close: '}', token: 'delimiter.curly' },
	]),

	tokenizer: Object.assign({}, baseLanguage.tokenizer, {
		root: [
			[/[a-zA-Z]\w*/, {
				cases: {
					'@keywords': 'keyword',
					'@default': 'identifier',
				}
			}],

			{ include: '@whitespace' },
			{ include: '@numbers' },

			[/[,:|]/, 'delimiter'],
			[/[{}\[\]()<>]/, '@brackets'],
		],
		whitespace: baseLanguage.tokenizer.whitespace.concat([
			[/(^#.*$)/, 'comment'],
		]),
	}),
})

export {
	conf,
	language,
}
