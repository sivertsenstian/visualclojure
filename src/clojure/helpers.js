const vscode = require('vscode');
const find = require('find');
const fs = require('fs');
const nreplClient = require('../nrepl/client');
const nreplMsg = require('../nrepl/message');
const exceptionParser = require('./exception_parser');
const SESSION_TYPE = require('../nrepl/session_type');

function trySetReplPort(state) {
    let path = vscode.workspace.rootPath,
        port = null;
    return new Promise((resolve, _) => {
        find.file(/\.nrepl-port$/, path, (files) => {
            if(files.length > 0) {
                fs.readFile(files[0], 'utf8', (err, data) => {
                    if(!err) {
                        state.port = parseFloat(data);
                        resolve(state);
                    }
                });
            }
        });
    });
}

function getNamespace(text) {
    let match = text.match(/^[\s\t]*\((?:[\s\t\n]*(?:in-){0,1}ns)[\s\t\n]+'?([\w.\-\/]+)[\s\S]*\)[\s\S]*/);
    return match ? match[1] : 'user';
};

function getActualWord(document, position, selected, word) {
    if (selected === undefined) {
        let selectedChar = document.lineAt(position.line).text.slice(position.character, position.character + 1),
            isFn = document.lineAt(position.line).text.slice(position.character - 1, position.character) === "(";
        if (this.specialWords.indexOf(selectedChar) !== -1 && isFn) {
            return selectedChar;
        } else {
            console.error("Unsupported selectedChar '" + selectedChar + "'");
            return word;
        }
    } else {
        return word;
    }
};

//using algorithm from: http://stackoverflow.com/questions/15717436/js-regex-to-match-everything-inside-braces-including-nested-braces-i-want/27088184#27088184
function getContentToNextBracket(block) {
    var currPos = 0,
        openBrackets = 0,
        stillSearching = true,
        waitForChar = false;

    while (stillSearching && currPos <= block.length) {
        var currChar = block.charAt(currPos);
        if (!waitForChar) {
            switch (currChar) {
                case '(':
                    openBrackets++;
                    break;
                case ')':
                    openBrackets--;
                    break;
                case '"':
                case "'":
                    waitForChar = currChar;
                    break;
                case '/':
                    var nextChar = block.charAt(currPos + 1);
                    if (nextChar === '/') {
                        waitForChar = '\n';
                    } else if (nextChar === '*') {
                        waitForChar = '*/';
                    }
                    break;
            }
        } else {
            if (currChar === waitForChar) {
                if (waitForChar === '"' || waitForChar === "'") {
                    block.charAt(currPos - 1) !== '\\' && (waitForChar = false);
                } else {
                    waitForChar = false;
                }
            } else if (currChar === '*') {
                block.charAt(currPos + 1) === '/' && (waitForChar = false);
            }
        }
        currPos++
        if (openBrackets === 0) {
            stillSearching = false;
        }
    }
    return [currPos, block.substr(0, currPos)];
};

function getContentToPreviousBracket(block) {
    var currPos = (block.length - 1),
        openBrackets = 0,
        stillSearching = true,
        waitForChar = false;

    while (stillSearching && currPos >= 0) {
        var currChar = block.charAt(currPos);
        if (!waitForChar) {
            switch (currChar) {
                case '(':
                    openBrackets--;
                    break;
                case ')':
                    openBrackets++;
                    break;
                case '"':
                case "'":
                    waitForChar = currChar;
                    break;
                case '/':
                    var nextChar = block.charAt(currPos + 1);
                    if (nextChar === '/') {
                        waitForChar = '\n';
                    } else if (nextChar === '*') {
                        waitForChar = '*/';
                    }
                    break;
            }
        } else {
            if (currChar === waitForChar) {
                if (waitForChar === '"' || waitForChar === "'") {
                    block.charAt(currPos - 1) !== '\\' && (waitForChar = false);
                } else {
                    waitForChar = false;
                }
            } else if (currChar === '*') {
                block.charAt(currPos + 1) === '/' && (waitForChar = false);
            }
        }
        currPos--
        if (openBrackets === 0) {
            stillSearching = false;
        }
    }
    return [currPos, block.substr(currPos + 1, block.length)];
};

function handleException(state, exceptions, isSelection = false) {
    let editor = vscode.window.activeTextEditor,
        filetypeIndex = (editor.document.fileName.lastIndexOf('.') + 1),
        filetype = editor.document.fileName.substr(filetypeIndex, editor.document.fileName.length);

    state.diagnosticCollection.clear();

    let exClient = nreplClient.create({
        host: state.hostname,
        port: state.port
    }).once('connect', function () {
        let msg = nreplMsg.stacktrace(state.session[filetype]),
            error = exceptionParser.error();
        exClient.send(msg, (results) => {
            if (results.length === 2
                && results[0].hasOwnProperty('status')
                && results[0].status[0] === "no-error"
                && results[1].status[0] === "done") {
                error = exceptionParser.parse(exceptions);
            } else {
                error.class = results[0].class
                error.cause = results[0].class
                error.url = results[0].file;
                error.line = results[0].line - 1;
                error.char = results[0].column - 1;
                error.message = results[1].message;
            }
            console.log("FINAL ERROR ->");
            console.log(error);
            let position = new vscode.Position(error.line, error.char),
                length = editor.document.lineAt(error.line).text.length;

            let range = new vscode.Range(error.line,
                                         error.char,
                                         error.line,
                                         length),
                diagnostics = [];
                diagnostics.push(new vscode.Diagnostic(range,
                                                       error.message,
                                                       vscode.DiagnosticSeverity.Error));
                for(var w = 0; w < error.warnings.length; w++) {
                    diagnostics.push(new vscode.Diagnostic(range,
                                                           error.warnings[w],
                                                           vscode.DiagnosticSeverity.Warning));
                }


            editor.selection = new vscode.Selection(position, position);
            state.diagnosticCollection.set(vscode.Uri.file(error.url), diagnostics);
        });
    });
};

function updateStatusbar(state) {
    if (state.hostname && state.port) {
        state.statusbar_connection.text = "nrepl://" + state.hostname + ":" + state.port;
    } else {
        state.statusbar_connection.text = "nrepl - click to connect";
    }
    state.statusbar_type.text = state.session_type.statusbar;
    switch (state.session_type.id) {
        case SESSION_TYPE.CLJ.id:
            state.statusbar_type.color = "rgb(144,180,254)";
            break;
        case SESSION_TYPE.CLJS.id:
            state.statusbar_type.color = "rgb(145,220,71)";
            break;
        default:
            state.statusbar_type.color = "rgb(192,192,192)";
            break;
    }
    state.statusbar_connection.command = "visualclojure.connect";
    state.statusbar_type.command = "visualclojure.toggleSession";

    state.statusbar_connection.show();
    state.statusbar_type.show();

};


module.exports = {
    getActualWord,
    getNamespace,
    handleException,
    getContentToNextBracket,
    getContentToPreviousBracket,
    updateStatusbar,
    trySetReplPort
};
