const _ = require('lodash');
const Rule = require('../../rule.js');
const Logic = require('../../logic.js');
const Common = require('../../common.js');

function cleanLogicData(logicData) {
    return Common.flattenWith(logicData, (data) => {
        if (!_.isString(data)) {
            throw new Error('All static items must be either arrays or strings');
        }

        return data;
    });
}

module.exports = (parentRule, actions, key, ...initalLogicData) => {
    if (_.isNil(initalLogicData)) {
        return parentRule;
    }

    if (!_.isString(key)) {
        throw new Error('Key must be a string');
    }

    const logicData = cleanLogicData(initalLogicData);

    const logic = Logic('raise', {
        options: {
            useToken: true
        },
        onValid: (context, content) => {
            const contents = content.contents;

            if (!_.isPlainObject(contents)) {
                return;
            }

            context.clear();

            if (_.isNil(contents[key])) {
                // key does not exist so there is nothing check for.
                return;
            }

            const presentItems = [];

            _.forEach(logicData, (item) => {
                if (Object.prototype.hasOwnProperty.call(contents, item)) {
                    presentItems.push(contents[item]);
                }
            });

            if (presentItems.length > 0) {
                const issues = [];

                _.forEach(presentItems, (item) => {
                    issues.push({
                        type: 'schema',
                        message: `Cannot exist when "${key}" exists`,
                        severity: 'error',
                        from: item.from,
                        location: item.location
                    });

                    context.raise(issues);
                });
            }
        }
    });

    const nextActions = _.clone(actions);

    return Rule('object-without', logic, nextActions, parentRule);
};
