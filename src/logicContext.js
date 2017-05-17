const EventEmitter = require('eventemitter3');
const Util = require('util');
const _ = require('lodash');
const ShortId = require('shortid');
const Issue = require('./issue');
const Common = require('./common.js');
const Scope = require('./scope.js');

const defaultOptions = {
    onFaultChange: false
};

function runEmits(force) {
    if (!force && this._status.runState !== 'started') {
        return;
    }

    if (this._status.raiseEmitPending) {
        this.emit('raise');

        this._status.raiseEmitPending = false;
    }

    if (this._status.valueEmitPending) {
        this._status.valueEmitPending = false;

        this.emit('update', this._status.valueState, this._currentValue);
    }

    if (this._status.stateEmitPending) {
        this._status.stateEmitPending = false;

        this.emit('state', this._status.fullValidationState);
    }
}

function getPreviousState() {
    if (!_.isNil(this._previousLogicContext)) {
        this._control.state = this._previousLogicContext.state();

        return this._control.state;
    }

    return 'passing';
}

function calculateFullValidationState() {
    let finalState = this._status.validationState;
    const prevState = getPreviousState.call(this);

    if (finalState === 'passing') {
        // Anything from the previous guy overwrites this.
        finalState = prevState;
    }

    if (this._status.fullValidationState !== finalState) {
        this._status.stateEmitPending = true;

        this._status.fullValidationState = finalState;
    }
}

function calculateValidationState() {
    this._status.validationState = this._livingIssues.length <= 0 && this._status.paramState === 'passing' ?
        'passing' :
        'failing';

    calculateFullValidationState.call(this);
}

function calculateValueState() {
    let newValueState = 'failing';

    if (this._status.runState === 'stopped' || this._status.runState === 'stopping') {
        newValueState = 'undefined';
    } else if (this._livingIssues.length <= 0 && this._status.paramState === 'passing') {
        newValueState = _.isUndefined(this._currentValue) ? 'undefined' : 'defined';
    }

    if (this._status.valueState !== newValueState) {
        this._status.valueState = newValueState;

        this._status.valueEmitPending = true;
    }
}

function _raise(...issueMeta) {
    let target;

    if (_.isNil(issueMeta[0])) {
        target = null;
    } else if (_.isArray(issueMeta[0])) {
        target = issueMeta[0];
    } else if (_.isPlainObject(issueMeta[0])) {
        target = [issueMeta[0]];
    } else if (!_.isNil(issueMeta[0]) && _.isString(issueMeta[0])) {
        target = [{ type: issueMeta[0], message: issueMeta[1], severity: issueMeta[2], from: issueMeta[3], location: issueMeta[4] }];
    }

    const newIssues = _.reduce(target, (current, issue) => {
        current.push(Issue(issue.type, issue.from, issue.location, issue.message, issue.severity));

        return current;
    }, []);

    // If both are empty then don't emit anything. It just creates noise.
    if (newIssues.length > 0 || this._livingIssues.length > 0) {
        this._livingIssues = newIssues;

        this._status.raiseEmitPending = true;
    }

    calculateValueState.call(this);
    calculateValidationState.call(this);

    runEmits.call(this);
}

function _set(value) {
    if (value === this._currentValue) {
        return false; // Did not result in an update
    }

    this._currentValue = value;

    calculateValueState.call(this);
    calculateValidationState.call(this);

    this._status.valueEmitPending = true;

    runEmits.call(this);

    return true; // Did result in an update
}

function _checkParameters(parameters) {
    let ready = true;
    const issues = [];

    _.forOwn(parameters.meta, (meta, name) => {
        const paramStatus = meta.status;

        if (meta.required) {
            if (paramStatus === 'undefined') {
                // The required value has never been defined and this is an issue.
                issues.push(Issue('rule', null, null, `Required rule value "${name}" is not defined.`, 'warning'));

                ready = false;
            } else if (paramStatus === 'failing') {
                // The required value has been defined but it's validation is failing.
                // The validation should be generating an issue for it so no need to create a new one.
                // This still marks us as not ready to run.
                ready = false;
            } else if (paramStatus !== 'defined') {
                throw new Error('Should never get here.');
            }

            return;
        }

        if (paramStatus === 'undefined') {
            // Then for some reason the definition is not ready yet.
            // We can no idea why so we are not going to do anything here.
            ready = false;
        } else if (paramStatus === 'failing') {
            // There is a context with issues here.

            ready = false;
        } else if (paramStatus !== 'defined') {
            throw new Error('Should never get here.');
        }
    });

    _.forOwn(parameters.contexts, (context) => {
        issues.push(...context.issues());
    });

    if (issues.length > 0) {
        ready = false;
    }

    return { ready, issues };
}

function _run() {
    const oldRunState = this._status.runState;
    this._status.runState = 'updating';

    const paramResult = _checkParameters(this._parameters);

    if (!paramResult.ready) {
        this._status.paramState = this._control.paramState = 'failing';

        if (this._options.runOnFailure && !_.isNil(this._onRun)) {
            // TODO: need to restrict onRun as this is a failure state.
            // TODO: No raise is allowed here.
            this._onRun.call(null, this._control, this._content, this._parameters.values);
        }

        // This is hear because we want to set the issues after run is called
        this._control.raise(paramResult.issues);
    } else {
        this._status.paramState = this._control.paramState = 'passing';

        this._control.raise();

        // Current value could have been set by setup.
        // So even if onRun does not exists we will still want to emit the value when we start up..
        if (!_.isNil(this._onRun)) {
            this._onRun.call(null, this._control, this._content, this._parameters.values);
        }
    }

    this._status.runState = oldRunState;
}

function _onStateUpdate(state) {
    this._control.state = state;

    if (this._options.onStateChange) {
        _run.call(this);
    }

    calculateFullValidationState.call(this);

    runEmits.call(this);
}

function createRuleContextInScope(scopeId, rule) {
    const ruleContext = this._ruleContext;

    const newScope = Scope(scopeId, this._ruleContext.scope);

    const newRuleContext = ruleContext.createRuleContext(rule, newScope);

    newRuleContext.on('disposed', () => {
        newScope.dispose();
    });

    return newRuleContext;
}

function createRuleContext(rule, tokenContext) {
    if (_.isNil(tokenContext)) {
        const ruleContext = this._ruleContext;

        return ruleContext.createRuleContext(rule, this._ruleContext.scope);
    }

    const runContext = require('./runContext.js')(); // eslint-disable-line

    tokenContext.addRunContext(runContext);

    return runContext.createRuleContext(rule, this._ruleContext.scope);
}

function buildLogicContext(logic) {
    const logicContext = logic.buildContext(true, `${this._id}`, this._ruleContext);

    this._ruleContext.addLogicContext(logicContext);

    return logicContext;
}

function register(targetScope, id, value, _status, force) {
    let _targetScope = targetScope;

    if (_.isNil(_targetScope)) {
        _targetScope = this._ruleContext.scope.id;
    }

    this._ruleContext.scope.set(_targetScope, id, value, _status, this, force);
}

function unregister(targetScope, id) {
    let _targetScope = targetScope;

    if (_.isNil(_targetScope)) {
        _targetScope = this._ruleContext.scope.id;
    }

    this._ruleContext.scope.remove(_targetScope, id, this);
}

function _buildControl(fullControl) {
    this._control = {
        data: this._ruleContext.data,
        id: this._id,
        state: 'passing',
        set: _set.bind(this),
        raise: _raise.bind(this),
        paramState: 'passing'
    };

    if (fullControl) {
        this._control.createRuleContext = createRuleContext.bind(this);
        this._control.createRuleContextInScope = createRuleContextInScope.bind(this);
        this._control.buildLogicContext = buildLogicContext.bind(this);
        this._control.register = register.bind(this);
        this._control.unregister = unregister.bind(this);
        this._control.scope = this._ruleContext.scope;
    }
}

function _updateParameter(name, status, value) {
    this._parameters.meta[name].status = status;

    if (status === 'defined') {
        this._parameters.values[name] = value;
    } else {
        delete this._parameters.values[name];
    }
}

function onParameterUpdate(name, status, value) {
    _updateParameter.call(this, name, status, value);

    if (this._status.runState === 'started') {
        _run.call(this);

        runEmits.call(this, true);
    }
}

function processDefinition(param, name) {
    const Logic = require('./logic'); // eslint-disable-line

    this._parameters.meta[name] = {
        required: false
    };

    if (param.value instanceof Logic) {
        const logicContext = param.value.buildContext(false, this._id, this._ruleContext);

        _updateParameter.call(this, name, logicContext.valueState(), logicContext.value());

        this._parameters.listeners[name] = Common.createListener(logicContext, 'update', null, onParameterUpdate.bind(this, name));
        this._parameters.contexts[name] = logicContext;
    } else {
        this._parameters.values[name] = param.value;
        this._parameters.meta[name].status = 'defined';
    }
}

function stopWatch(name) {
    if (!_.isNil(this._parameters.listeners[name])) {
        // Stop the old watch
        this._parameters.listeners[name]();
        delete this._parameters.listeners[name];
    }
}

function _onWatchUpdate(name, status, value) {
    if (status !== 'defined') {
        // kill the watch
        this._parameters.meta[name].watchId = null;

        stopWatch.call(this, name);

        _updateParameter.call(this, name, status, value);

        return;
    } else if (value === this._parameters.meta[name].watchId) {
        // Id did not change so no need to reload the watch
        return;
    }

    stopWatch.call(this, name);

    this._parameters.meta[name].watchId = value;

    this._parameters.listeners[name] = this._ruleContext.scope.watch(value, onParameterUpdate.bind(this, name));
}

function processRequired(param, name) {
    const Logic = require('./logic'); // eslint-disable-line

    this._parameters.meta[name] = {
        required: true,
        status: 'undefined',
        watchId: null
    };

    if (param.value instanceof Logic) {
        const logicContext = param.value.buildContext(false, this._id, this._ruleContext);

        _updateParameter.call(this, name, 'undefined', undefined);

        const update = _onWatchUpdate.bind(this, name);

        logicContext.on('update', update);

        update(logicContext.valueState(), logicContext.value());

        this._parameters.contexts[name] = logicContext;
    } else {
        const listener = this._ruleContext.scope.watch(param.value, onParameterUpdate.bind(this, name));

        this._parameters.listeners[name] = listener;
        this._parameters.meta[name].watchId = param.value;
    }
}

function processParameters(parameters) {
    this._parameters = {
        values: {},
        meta: {},
        contexts: {},
        listeners: {}
    };

    const Logic = require('./logic'); // eslint-disable-line

    _.forOwn(parameters, (param, name) => {
        if (param.required) {
            processRequired.call(this, param, name);
        } else {
            processDefinition.call(this, param, name);
        }
    });

    this._disposables.push(() => {
        _.forOwn(this._parameters.listeners, (listener) => {
            if (!_.isNil(listener)) {
                listener();
            }
        });
    });
}

function validateInput(properties, callbacks, parameters) {
    if (_.isNil(properties)) {
        throw new Error('The properties argument is required');
    }

    if (!_.isString(properties.name) || properties.name.length <= 0) {
        throw new Error('name must be a valid string');
    }

    if (_.isNil(callbacks)) {
        throw new Error('The callbacks argument is required');
    }

    if (_.isNil(parameters)) {
        throw new Error('The parameters argument is required');
    }
}

function LogicContext(properties, callbacks, parameters, options) {
    if (!(this instanceof LogicContext)) {
        return new LogicContext(properties, callbacks, parameters, options);
    }

    EventEmitter.call(this);

    validateInput(properties, callbacks, parameters, options);

    this._options = _.isNil(options) ? defaultOptions : options;

    this._disposables = [];

    this._ruleContext = properties.parent;

    this._name = properties.name;
    this._id = `${properties.name}-${ShortId.generate()}`;

    this._content = this._options.useToken ?
        this._ruleContext.tokenContext :
        this._ruleContext.tokenContext.getRaw();

    this._status = {
        runState: 'stopped',
        valueState: 'undefined',
        paramState: 'passing',
        validationState: 'passing',
        fullValidationState: 'passing',
        valueEmitPending: false,
        raiseEmitPending: false,
        stateEmitPending: false,
    };

    this._livingIssues = [];

    this._onRun = callbacks.onRun;
    this._onPause = callbacks.onPause;
    this._onTeardown = callbacks.onTeardown;
    this._currentValue = undefined;

    processParameters.call(this, parameters);

    _buildControl.call(this, properties.fullControl);

    if (!_.isNil(properties.previous)) {
        this._previousLogicContext = properties.previous;

        this._disposables.push(Common.createListener(properties.previous, 'state', this, _onStateUpdate, () => {
            this._previousLogicContext = null;
        }));
    }

    if (!_.isNil(callbacks.onSetup)) {
        callbacks.onSetup.call(null, this._control, this._content);
    }

    calculateFullValidationState.call(this);

    if (_.isNil(this._onRun)) {
        if (parameters.length > 0) {
            throw new Error('onRun was not defined even though define and/or required where called.');
        }
    }

    // clear these since there is no way for someone to be listening yet.
    this._status.valueEmitPending = false;
    this._status.stateEmitPending = false;
    this._status.raiseEmitPending = false;
}

Util.inherits(LogicContext, EventEmitter);

LogicContext.prototype.state = function state() {
    Common.checkDisposed(this);

    return this._status.fullValidationState;
};

LogicContext.prototype.valueState = function state() {
    Common.checkDisposed(this);

    return this._status.valueState;
};

LogicContext.prototype.issues = function issues() {
    Common.checkDisposed(this);

    return this._livingIssues;
};

LogicContext.prototype.start = function start() {
    Common.checkDisposed(this);

    // If we are already starting or are started then we should not do anything.
    if (this._status.runState === 'started' || this._status.runState === 'starting') {
        return;
    }

    this._status.runState = 'starting';

    getPreviousState.call(this);

    _.forOwn(this._parameters.contexts, (context) => {
        context.start();
    });

    _run.call(this);

    calculateFullValidationState.call(this);
    calculateValueState.call(this);

    runEmits.call(this, true);

    this._status.runState = 'started';
};

LogicContext.prototype.stop = function stop() {
    // Fail because we are already disposed.
    Common.checkDisposed(this);

    // If we are already stopping or are stopped then we should not do anything.
    if (this._status.runState === 'stopped' || this._status.runState === 'stopping') {
        return;
    }

    this._status.runState = 'stopping';

    _.forOwn(this._parameters.contexts, (context) => {
        context.stop();
    });

    if (!_.isNil(this._onPause)) {
        this._onPause.call(null, this._control, this._content, this._currentValue);
    }

    this._control.raise();

    this._status.updateRequired = true;
    this._status.valueState = 'undefined';

    runEmits.call(this, true);

    this._status.runState = 'stopped';
};

LogicContext.prototype.value = function value() {
    Common.checkDisposed(this);

    return this._currentValue;
};

LogicContext.prototype.dispose = function dispose() {
    // Warn the user that disposed has already been called.
    Common.checkDisposed(this, true);

    // If we are already disposed or are disposing then we should not do anything.
    if (this._status.runState === 'disposed' || this._status.runState === 'disposing') {
        return { commit: () => {} };
    }

    this._status.runState = 'disposing';

    this.emit('disposing');

    _.forEach(this._disposables, (listener) => {
        listener();
    });

    const commits = [];

    _.forOwn(this._parameters.contexts, (context) => {
        commits.push(context.dispose().commit);
    });

    return {
        commit: () => {
            _.forEach(commits, (commit) => {
                commit();
            });

            if (!_.isNil(this._onTeardown)) {
                this._onTeardown.call(null, this._control, this._content, this._currentValue);
            }

            this._control.raise();

            this._status.updateRequired = true;
            this._status.valueState = 'undefined';

            runEmits.call(this, true);

            this._status.runState = 'disposed';

            this.emit('disposed');
        }
    };
};

module.exports = LogicContext;
