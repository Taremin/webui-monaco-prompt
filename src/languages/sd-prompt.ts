import {languages} from 'monaco-editor/esm/vs/editor/editor.api'

const conf: languages.LanguageConfiguration = {
	comments: {
	},
	brackets: [
		['[', ']'],
		['(', ')'],
	],
	autoClosingPairs: [
		{ open: '[', close: ']' },
		{ open: '(', close: ')' },
		{ open: '<', close: '>' },
	],
	surroundingPairs: [
		{ open: '[', close: ']' },
		{ open: '(', close: ')' },
	],
	wordPattern: new RegExp('[^\\s,{}\\[\\]()<>:#]+')
}

const language: languages.IMonarchLanguage = {
	defaultToken: '',
	tokenPostfix: '.prompt',

	keywords: [
        "lora",
        "hypernet",
		"AND",
		"BREAK",
	],

	brackets: [
		{ open: '[', close: ']', token: 'delimiter.bracket' },
		{ open: '(', close: ')', token: 'delimiter.parenthesis' },
		{ open: '<', close: '>', token: 'delimiter.angle' },
	],

	escapes: /\\./,

	tokenizer: {
		root: [
			[/[a-zA-Z]\w*/, {
				cases: {
					'@keywords': 'keyword',
					'@default': 'identifier',
				}
			}],

			{ include: '@whitespace' },
			{ include: '@numbers' },

			[/[,:]/, 'delimiter'],
			[/[\[\]()<>]/, '@brackets'],
		],

		whitespace: [
			[/\s+/, 'white'],
		],

		numbers: [
			[/-?(\d*\.)?\d+/, 'number']
		],
	}
}

export {
	conf,
	language,
}
