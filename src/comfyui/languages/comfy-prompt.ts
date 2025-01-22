
import {languages} from 'monaco-editor/esm/vs/editor/editor.api'
import {conf as baseConf, language as baseLanguage} from '../../languages/sd-prompt'

const conf: languages.LanguageConfiguration = Object.assign({}, baseConf, {
	comments: Object.assign({}, baseConf.comments, {
		lineComment: '//',
        blockComment: ["/*", "*/"],
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

const whitespace: languages.IMonarchLanguageRule[] = [
    [/\/\*/, 'comment', '@comment'], // block comment
    [/\/\/.*$/, 'comment'], // line comment
]

const comments: languages.IMonarchLanguageRule[] = [
    [/[^\/*]+/, 'comment'],
    // [/\/\*/, 'comment', '@push' ],    // nested comment not allowed :-(
    // [/\/\*/,    'comment.invalid' ],    // this breaks block comments in the shape of /* //*/
    [/\*\//, 'comment', '@pop'],
    [/[\/*]/, 'comment']
]

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
    whitespace,
    comments,
}
