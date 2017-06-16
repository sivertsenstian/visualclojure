const vscode = require('vscode');
const _ = require('lodash');
const helpers = require('./helpers');
const exceptionInfo = "class clojure.lang.ExceptionInfo";

function error (r = {}) {
    return Object.assign(
        {class: null,
         cause: null,
         message: null,
         warnings: [],
         line: null,
         char: null,
         url: null}
        , r)
}

function parse(stacktrace) {
    let result = error(),
        [cause, ...r] = _.filter(stacktrace,
                                 (s) => { return s.hasOwnProperty('ex')
                                                 && s.ex === exceptionInfo; }),
        errors = _.flatMap(stacktrace,
                           (s) => { return s.hasOwnProperty('err')
                                           && s.err.indexOf("line") !== -1
                                           && s.err.indexOf("column") !== -1
                                           ? [s.err] : [];})
                  .join();

        result.warnings = _.flatMap(stacktrace,
                           (s) => { return s.hasOwnProperty('err')
                                           && s.err.toLowerCase().indexOf("warning") !== -1
                                           ? [trimMessage(s.err)] : [];});

    if (cause) {
        result.cause = cause["root-ex"]
                       .replace("class","")
                       .trim();
    }

    let errorParts = errors.split(' ');;
    if (errors.indexOf("starting at line") !== -1
        && errors.indexOf("and column") !== -1) {
        result.message = errors.substring(errors.indexOf("clojure.lang.ExceptionInfo:") + 27,
                                          errors.indexOf("starting"));
    } else if (errorParts.indexOf("at line") !== -1
                && errorParts.indexOf("and column") === -1) {
        errorParts = errors.substring(errors.indexOf('{'),
                                        errors.indexOf('}'))
                                        .replace(/:/g, '')
                                        .replace(/,/g, '')
                                        .replace(/\r\n/, '')
                                        .replace(/}/, '')
                                        .split(' ');
        result.message = errors.substring(errors.indexOf("clojure.lang.ExceptionInfo:") + 27,
                                    errors.indexOf("at line"));
    } else if (errorParts.indexOf(":line") !== -1
                && errorParts.indexOf(":column") !== -1) {
        errorParts = errors.substring(errors.indexOf('{'),
                                        errors.indexOf('}'))
                                        .replace(/:/g, '')
                                        .replace(/,/g, '')
                                        .replace(/\r\n/, '')
                                        .replace(/}/, '')
                                        .split(' ');
        result.message = errors.substring(errors.indexOf("clojure.lang.ExceptionInfo:") + 27,
                                    errors.indexOf("{"));
    }

    if (errorParts.indexOf("line")) {
        result.line = parseInt(errorParts[errorParts.indexOf("line") + 1], 10) - 1;
    }
    if (errorParts.indexOf("column")) {
        result.char = parseInt(errorParts[errorParts.indexOf("column") + 1], 10) - 1;
    }
    ensureFileLine(result);
    result.message = trimMessage(result.message);

    console.log(result);
    return result;
}

function ensureFileLine (error) {
    let editor = vscode.window.activeTextEditor,
        wc = error.warnings.length;

    error.url = error.url || editor.document.fileName;
    error.line = error.line || editor.selection.start.line;
    error.char = error.char || 0;
    if (error.message === null && wc === 0) {
        error.message = "Unknown error detected on this line.."
    } else {
        error.message = error.message || "";
    }
    if (wc > 0) {
        error.message += "\n" + wc + " warning(s) detected"
    }
}

function trimMessage (m) {
    if (m.indexOf("in file") !== -1) {
        m = m.substring(0, m.indexOf("in file"))
    }
    if (m.indexOf("at line") !== -1) {
        m = m.substring(0, m.indexOf("at line"))
    }
    return m.trim();
}

module.exports = {
    parse,
    error
}
