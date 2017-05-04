const _ = require('lodash');
const Rule = require('../../rule.js');
const Logic = require('../../logic.js');

function onTreeChange(context, content, runningData) {
    if (!runningData.running) {
        return;
    }

    context.register(runningData.targetScope, runningData.id, runningData.getTargetValue(), runningData.getReadyStatus(), true);
}

function registerAction(parentRule, actions, data) {
    let id = data;
    let targetScope = null;
    let value = null;
    let when = null;

    if (_.isPlainObject(data)) {
        id = data.id;
        targetScope = data.scope;
        value = data.value;
        when = data.when;
    }

    if (!_.isString(id) && !(id instanceof Logic)) {
        throw new Error('ID must be a string or an Rapture logic object which results in a string');
    }

    if (!_.isNil(targetScope) && !_.isString(targetScope)) {
        throw new Error('When defined scope must be a string');
    }

    if (_.isNil(when)) {
        when = 'this';
    } else if (when !== 'always' && when !== 'this' && when !== 'tree') {
        throw new Error('When defined targetScope must be a string');
    }

    const logicComponents = {
        options: {
            onFaultChange: true,
            useToken: true,
            onFailure: true
        },
        define: [{ id: 'registerID', value: id }],
        onSetup: (context, content) => {
            const runningData = {
                targetScope,
                running: false
            };

            if (when !== 'tree') {
                return runningData;
            }

            runningData.listener = onTreeChange.bind(null, context, content, runningData);

            content.on('update', runningData.listener);

            return runningData;
        },
        onRun: (context, content, params, currentValue) => {
            const _runningData = currentValue;

            _runningData.running = false;

            if (!_.isNil(_runningData.id) && _runningData.id !== params.registerID) {
                // If the old id is not the same as the new one then we need to unregister the old id.
                context.unregister(targetScope, _runningData.id);
            }

            _runningData.getReadyStatus = () => {
                return !context.isFailed && (when === 'always' ||
                        (when === 'this' && !context.isFaulted) ||
                        (when === 'tree' && content.issues().length <= 0 && !context.isFaulted));
            };

            _runningData.getTargetValue = () => {
                return _.isNil(value) ? content.getRaw() : params.registerValue;
            };

            const valueReady = _runningData.getReadyStatus();
            const targetValue = _runningData.getTargetValue();
            // }

            if (!_.isNil(params.registerID)) {
                // create/update the value in the targetScope.
                context.register(targetScope, params.registerID, targetValue, valueReady, true);

                _runningData.id = params.registerID;
                _runningData.targetValue = targetValue;
                _runningData.running = true;
            } else {
                _runningData.running = false;
            }

            return _runningData;
        },
        onPause: (context, content, currentValue) => {
            const _runningData = currentValue;

            _runningData.running = false;

            if (!_.isNil(_runningData.id)) {
                context.unregister(targetScope, _runningData.id);
            }
        },
        onTeardown: (context, content, currentValue) => {
            const _runningData = currentValue;

            _runningData.running = false;

            if (!_.isNil(_runningData.id)) {
                context.unregister(targetScope, _runningData.id);
            }

            if (!_.isNil(_runningData.listener)) {
                content.removeListener('raise', _runningData.listener);
            }
        }
    };

    if (!_.isNil(value)) {
        logicComponents.define.push({ id: 'registerValue', value });
    }

    const logic = Logic(logicComponents);

    return Rule('register', logic, actions, parentRule);
}

module.exports = registerAction;
