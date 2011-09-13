/*
 scrappit.js
 http://scrappit.org
 Available via the MIT License
 Author: Josh Dzielak, Copyright (c) 2011
*/
(function(context, global, document) {

  var version = "0.1.0",

      //scrappit's namespace as a module/global
      nsScrappit = 'scrappit',

      //existing scrappit in context
      ctxScrappit = context[nsScrappit],

      //a queue placed in advance to run once scrappit is initialized
      readyQueue = ctxScrappit && ctxScrappit.readyQueue,
      amd,
      guidCt = 0,

      //optimize minification
      undef = undefined,
      strUndef = '' + undef,
      toString = Object.prototype.toString,
      console = global.console;

  //common helper functions
  function isFunction(obj) {
    return toString.call(obj) === '[object Function]';
  }

  function isArray(obj) {
    return toString.call(obj) === '[object Array]';
  }

  function isObject(obj) {
    return toString.call(obj) === '[object Object]';
  }

  function clone(obj) {
    var newObj = (isArray(obj)) ? [] : {};
    for (i in obj) {
      if (obj[i] && isObject(obj[i])) {
        newObj[i] = clone(obj[i]);
      } else newObj[i] = obj[i]
    } return newObj;
  }

  function warn(msg) {
    console && isFunction(console.warn) && console.warn(msg);
  }

  function guid() {
    return ((++guidCt) + new Date().getTime().toString().slice(5));
  }

  //add publish/subscribe methods any object
  //inspired by pubsubjs - Morgan Roderick http://roderick.dk
  var addPubSub = (function() {

    var _nextToken = -1;

    function nextToken() {
      return (++_nextToken).toString();
    }

    function publish(messages, message, data, sync) {
      if (!messages.hasOwnProperty(message)) {
        return false;
      }
      var publishFunc = function() {
        var subscribers = clone(messages[message]); //avoid concurrent mod errors
        for (var i = 0, j = subscribers.length; i < j; i++) {
          var subscriber = subscribers[i];
          if (subscriber) {
            subscriber.func(data);
          }
        }
      };
      if (sync === true) {
        publishFunc();
      } else {
        setTimeout(publishFunc, 0);
      }
      return true;
    }

    function subscribe(messages, message, func) {
      if (!messages.hasOwnProperty(message)) {
        messages[message] = [];
      }
      var token = nextToken();
      messages[message].push({ token : token, func : func });
      return token;
    }

    function unsubscribe(messages, token) {
      for (var m in messages) {
        if (messages.hasOwnProperty(m)) {
          for (var i = 0, j = messages[m].length; i < j; i++) {
            if (messages[m][i].token === token) {
              messages[m].splice(i, 1);
              return true;
            }
          }
        }
      }
      return false;
    }

    return function(obj) {
      var messages = obj.messages = {}; //export for debugging
      obj.publish = function(message, data) {
        return publish(messages, message, data, false);
      };
      obj.publishSync = function(message, data) {
        return publish(messages, message, data, true);
      };
      obj.subscribe = function(message, func) {
        return subscribe(messages, message, func);
      };
      obj.unsubscribe = function(token) {
        return unsubscribe(messages, token);
      };
    }
  })();

  //is ctxScrappit has amd on it, prefer that instead
  //while it'd be nice to try and default to require/define
  //in context, its probably not safe yet, and scrappit's
  //namespaced amd is totally predictable when bundled with requirejs
  var amdSource;
  if (ctxScrappit && ctxScrappit.define && ctxScrappit.define.amd) {
    amdSource = ctxScrappit;
  } else {
    amdSource = context;
  }

  var define = amdSource.define,
      require = amdSource.require,
      requirejs = amdSource.requirejs,
      amd = define && define.amd;

  //setup scrappit internally
  //this is wrapped because it might not need to be executed
  //if scrappit is already present as a function (see below)
  var scrappit = function() {

    //wrap for module definition
    var scrappit = function(scrapp) {
      return runScrapp(scrapp);
    };

    //exported as scrappit() - this function takes a scrapp and runs it
    //a scrapp is an object that has at minimum a launch property
    function runScrapp(scrapp) {
      //mixin some framework to the provided scrapp object
      extendScrapp(scrapp);

      //let plugins act on scrapps before launch
      //avoid async here, might not apply in time
      scrappit.publishSync('beforeLaunch.scrapp', scrapp);

      provideAndLaunch(scrapp);
    }

    function extendScrapp(scrapp) {
      scrapp._uid = scrapp._uid || scrapp.id || guid();
      scrapp._deps_context = nsScrappit + '/' + scrapp._uid + '/deps';

      addPubSub(scrapp);

      //setup a requireDeps method that'll have a unique context applied,
      //such that requires by this scrapp dont interfere with scrappit or other contexts
      scrapp.requireDeps = function(cfg, deps, callback) {
        if (amd) {
          var depsContext = scrapp._deps_context;
          if (isObject(cfg)) {
            cfg.context = depsContext;
          } else {
            callback = deps, deps = cfg, cfg = {};
          }
          cfg.context = depsContext;

          require(cfg, deps, callback);
        }
      };

      //wrapper for when dependencies are ready
      scrapp.onDependenciesReady = function() {
        launchScrapp(scrapp);
      }

      //closing a scrapp publishes a close message
      scrapp.close = function() {
        scrapp.publish('close');
      };

      var scrappCloseToken, scrappitCloseToken;

      function unsubscribeTokens() {
        scrapp.unsubscribe(scrappCloseToken);
        scrappit.unsubscribe(scrappitCloseToken);
      }

      //when the scrapp closes, tell scrappit
      scrappCloseToken = scrapp.subscribe('close', function() {
        unsubscribeTokens();
        scrappit.publish('close.scrapp', scrapp);
      });

      //when scrappit closes, tell the scrapp
      scrappitCloseToken = scrappit.subscribe('close', function(scrappit) {
        unsubscribeTokens();
        scrapp.close();
      });
    }

    //inspects the scrapp's require property and attempts to resolve
    //dependencies before launching the scrapp
    //require can be an array of full URL's or a configuration object
    //containing paths, deps, baseUrl, etc.
    //if a dependency supports AMD and registers via a define call,
    //the result of the define will be curried to the launch method
    function provideAndLaunch(scrapp) {
      if (scrapp.require) {
        if (amd) {
          var cfg = {}, deps = scrapp.require;
          if (isObject(scrapp.require)) {
            cfg = scrapp.require;
            deps = scrapp.require.deps;
          }
          scrapp.requireDeps(cfg, deps, function() {
            var args = arguments;
            var oldScrappLaunch = scrapp.launch;
            scrapp.launch = function() {
              oldScrappLaunch.apply(scrapp, args);
            };
            scrapp.onDependenciesReady();
          });
        }
      } else {
        //no dependencies, launch
        scrapp.onDependenciesReady();
      }
      return scrapp;
    }

    //launches the scrapp
    function launchScrapp(scrapp) {
      try {
        //fire the actual method defined in the scrapp
        //arguments may have been bound already due to deps
        scrapp.launch();

        //typically, bind to scrapp.launch if you're interested in when scrapps
        //launch, e.g. notify the user that a scrapp launched
        scrappit.publish('launch.scrapp', scrapp);

      } catch (e) {
        //scrapp launch failed, likely due to bad code in the launch
        //method of the scrapp. exception is not thrown as it may
        //interfere with scrapps that are ok. exception is logged if possible.
        if (console) {
          console.error('The launch method of this scrapp threw an exception:');
          console.error(scrapp);
          console.error(e);
        }
      }
    }

    function init() {

      //assign a uid
      scrappit._uid = guid();

      //add publish and subscribe
      addPubSub(scrappit);

      if (scrappit.amd = amd) {
        //copy amd onto scrappit
        scrappit.define = define;
        scrappit.require = require;
        scrappit.requirejs = requirejs;
      }

      //call to close scrappit and remove it,
      //also closing anything listening on the close event
      scrappit.close = function() {
        //publish sync so global is available but also pass reference
        //in case its not
        scrappit.publish('close', scrappit);
        //need to come after, cant share event handler
        context[nsScrappit] = undef;
      }

      //scrappit.readyQueue should always be an array of callback/configuration
      //objects intended to be run when scrappit is ready
      //this allows scrappit to be included by more than once source without
      //race conditions around callbacks & config objects
      //
      //the best practice in general for including scrappit on a page is:
      //
      //  var scrappit = this.scrappit || { readyQueue : [] };
      //  scrappit.readyQueue.push({
      //    ready : function() { //your scrappit callback here }
      //  }
      //
      // -> now load scrappit.js
      //
      //multiple scrappits can coexist in this manner
      scrappit.readyQueue = [];
    }

    init();

    return scrappit;
  };

  function exportScrappit(scrappit) {
    context[nsScrappit] = scrappit;
  }

  function processReadyQueue() {
    //process and reset the ready queue
    if (readyQueue) {
      for (var i = 0; i < readyQueue.length; i++) {
        var readyItem = readyQueue[i];
        if (isFunction(readyItem)) {
          readyItem();
        } else if (isObject(readyItem)) {
          if (amd) {
            require(readyItem);
          }
        }
      }
      ctxScrappit.readyQueue = []; //to avoid being called again
    }
  }

  function init() {
    //only initialize and export if not already on the page
    if (!isFunction(ctxScrappit)) {

      scrappit = scrappit(); //unwrap it

      //export to global for consistency - whether AMD in play or
      //not, scrappit as a func is base for a predictable namespace
      exportScrappit(scrappit);

      if (scrappit.amd) {
        //register scrappit module via define anonymous definition
        //make sure you include via require and not just a script tag
        //to avoid "Mismatched anonymous define module" error
        //even better - optimize with the require js optimizer, which
        //will assign the proper module name here
        define(function() {
          return scrappit;
        });
      }
    }

    //run the ready queue, even if scrappit was present
    //allows different sources to drop scrappit onto the page
    //and get a callback with scrappit present
    //set in timeout so that require js processes the define call above
    //before the ready queue - stuff in ready queue can cause scrappit
    //to be required outside of the root context and break other code
    setTimeout(processReadyQueue, 0);
  }

  init();

})(this, window, document);
