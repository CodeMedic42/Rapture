const _ = require('lodash');
const Rule = require('../../rule.js');
const Logic = require('../../logic.js');

function maxAction(parentRule, actions, maxData) {
    if (!_.isFinite(maxData) && !(maxData instanceof Logic)) {
        throw new Error('Must be a finite value or a Rapture logic instance');
    }

    const logic = Logic('raise', {
        define: { id: 'maxData', value: maxData },
        onValid: (control, content, params) => {
            if (_.isString(content) && content.length > params.maxData) {
                control.raise('schema', `Must be less than ${params.maxData + 1} characters long.`, 'error');
            } else {
                control.clear();
            }
        }
    });

    const nextActions = _.clone(actions);

    return Rule('string-max', logic, nextActions, parentRule);
}

module.exports = maxAction;
