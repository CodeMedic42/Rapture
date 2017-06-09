const EventEmitter = require('eventemitter3');
const Util = require('util');
const _ = require('lodash');
const Common = require('./common.js');

function emitRaise(force) {
    if (this.status === 'started' || force) {
        this.emit('raise', this.issues);

        return;
    }

    this.status = 'emitNeeded';
}

function onRaise() {
    const issues = _.reduce(this.logicContexts, (current, context) => {
        current.push(...context.issues());

        return current;
    }, []);

    _.reduce(this.ruleContexts, (current, context) => {
        current.push(...context.issues());

        return current;
    }, issues);

    if (issues.length === 0 && this.compacted.length === 0) {
        // raise nothing
        return;
    }

    this.compacted = issues;

    emitRaise.call(this);
}

function RuleContext(tokenContext, rule, scope, sharedData) {
    if (!(this instanceof RuleContext)) {
        return new RuleContext(tokenContext, rule, scope, sharedData);
    }

    EventEmitter.call(this);

    this.scope = scope;
    this.logicContexts = [];
    this.ruleContexts = [];
    this.compacted = [];
    this.tokenContext = tokenContext;
    this.status = 'stopped';
    this.rule = rule;
    this.data = sharedData || {};

    rule.applyLogic(this);
}

Util.inherits(RuleContext, EventEmitter);

RuleContext.prototype.issues = function issues() {
    return this.compacted;
};

RuleContext.prototype.addLogicContext = function addLogicContext(logicContext) {
    Common.checkDisposed(this);

    this.logicContexts.push(logicContext);

    logicContext.on('raise', onRaise, this);
};

RuleContext.prototype.start = function start() {
    Common.checkDisposed(this);

    if (this.status === 'started' || this.status === 'starting') {
        return;
    }

    this.status = 'starting';

    _.forEach(this.logicContexts, (logicContext) => {
        logicContext.start();
    });

    if (this.status === 'emitNeeded') {
        emitRaise.call(this, true);
    }

    this.status = 'started';
};

RuleContext.prototype.stop = function stop() {
    if (this.status === 'stopped' || this.status === 'stopping' || this.status === 'disposed') {
        return;
    }

    this.status = 'stopping';

    _.forEach(this.logicContexts, (logicContext) => {
        logicContext.stop();
    });

    if (this.status === 'emitNeeded') {
        emitRaise.call(this, true);
    }

    this.status = 'stopped';
};

// RuleContext.prototype.updateTokenValue = function updateTokenValue(newTokenValue) {
//     Common.checkDisposed(this);
//
//     const oldStatus = this.status;
//
//     this.status = 'updating';
//
//     const commits = [];
//
//     _.forEach(this.logicContexts, (logicContext) => {
//         commits.push(logicContext.dispose().commit);
//     });
//
//     _.forEach(this.ruleContexts, (ruleContext) => {
//         commits.push(ruleContext.dispose().commit);
//     });
//
//     _.forEach(commits, (commit) => {
//         commit();
//     });
//
//     this.logicContexts = [];
//
//     // Only Update the tokenContext after disposal.
//     this.tokenContext = newTokenValue;
//
//     this.rule.applyLogic(this);
//
//     if (oldStatus === 'started') {
//         _.forEach(this.logicContexts, (logicContext) => {
//             logicContext.start();
//         });
//     }
//
//     if (this.status === 'emitNeeded') {
//         emitRaise.call(this, true);
//     }
//
//     this.status = oldStatus;
// };

RuleContext.prototype.dispose = function dispose() {
    Common.checkDisposed(this, true);

    if (this.runStatus === 'disposed' || this.runStatus === 'disposing') {
        return { commit: () => {} };
    }

    this.runStatus = 'disposing';

    const commits = [];

    _.forEach(this.logicContexts, (logicContext) => {
        commits.push(logicContext.dispose().commit);
    });

    _.forEach(this.ruleContexts, (ruleContext) => {
        commits.push(ruleContext.dispose().commit);
    });

    return {
        commit: () => {
            _.forEach(commits, (commit) => {
                commit();
            });

            this.logicContexts = null;

            this.status = 'disposed';

            this.emit('disposed');
        }
    };
};

module.exports = RuleContext;
