Function('return this')()['Engine'] = (function() {
	var unloadAfterInit = true;
	var canvas = null;
	var resizeCanvasOnStart = false;
	var customLocale = null;
	var wasmExt = '.wasm';

	var preloader = new Preloader();
	var rtenv = null;

	var executableName = '';
	var loadPath = '';
	var loadPromise = null;
	var initPromise = null;
	var stderr = null;
	var stdout = null;
	var progressFunc = null;
	var browserFSConfig = null;

	function load(basePath) {
		if (loadPromise == null) {
			loadPath = basePath;
			loadPromise = preloader.loadPromise(basePath + wasmExt);
			preloader.setProgressFunc(progressFunc);
			requestAnimationFrame(preloader.animateProgress);
		}
		return loadPromise;
	};

	function unload() {
		loadPromise = null;
	};

	/** @constructor */
	function Engine() {};

	Engine.prototype.init = /** @param {string=} basePath */ function(basePath) {
		if (initPromise) {
			return initPromise;
		}
		if (loadPromise == null) {
			if (!basePath) {
				initPromise = Promise.reject(new Error("A base path must be provided when calling `init` and the engine is not loaded."));
				return initPromise;
			}
			load(basePath);
		}
		var config = {};
		if (typeof stdout === 'function')
			config.print = stdout;
		if (typeof stderr === 'function')
			config.printErr = stderr;
		initPromise = new Promise(function(resolve, reject) {
			config['locateFile'] = Utils.createLocateRewrite(loadPath);
			config['instantiateWasm'] = Utils.createInstantiatePromise(loadPromise);
			Godot(config).then(function(module) {
				rtenv = module;
				if (unloadAfterInit) {
					unload();
				}
				resolve();
			});
		});
		return initPromise;
	};

	/** @type {function(string, string):Object} */
	Engine.prototype.preloadFile = function(file, path) {
		return preloader.preload(file, path);
	};

	/** @type {function(...string):Object} */
	Engine.prototype.start = function() {
		// Start from arguments.
		var args = [];
		for (var i = 0; i < arguments.length; i++) {
			args.push(arguments[i]);
		}
		var me = this;
		return me.init().then(function() {
			if (!(canvas instanceof HTMLCanvasElement)) {
				canvas = Utils.findCanvas();
			}

			// Canvas can grab focus on click, or key events won't work.
			if (canvas.tabIndex < 0) {
				canvas.tabIndex = 0;
			}

			// Disable right-click context menu.
			canvas.addEventListener('contextmenu', function(ev) {
				ev.preventDefault();
			}, false);

			// Until context restoration is implemented warn the user of context loss.
			canvas.addEventListener('webglcontextlost', function(ev) {
				alert("WebGL context lost, please reload the page");
				ev.preventDefault();
			}, false);

			// Browser locale, or custom one if defined.
			var locale = customLocale;
			if (!locale) {
				locale = navigator.languages ? navigator.languages[0] : navigator.language;
				locale = locale.split('.')[0];
			}
			rtenv['locale'] = locale;
			rtenv['canvas'] = canvas;
			rtenv['thisProgram'] = executableName;
			rtenv['resizeCanvasOnStart'] = resizeCanvasOnStart;
			rtenv['engine'] = me;
			// Setup persistent file system (if selected).
			var fsCfg = JSON.parse(JSON.stringify(browserFSConfig)); // Deep copy, the config object will be modified.
			return Utils.initBrowserFS(fsCfg, rtenv);
		}).then(function() {
			return new Promise(function(resolve, reject) {
				if (!rtenv) {
					reject(new Error('The engine must be initialized before it can be started'));
				}
				preloader.preloadedFiles.forEach(function(file) {
					Utils.copyToFS(rtenv['FS'], rtenv['ERRNO_CODES'], file.path, file.buffer);
				});
				preloader.preloadedFiles.length = 0; // Clear memory
				rtenv['callMain'](args);
				initPromise = null;
				resolve();
			});
		});
	};

	Engine.prototype.startGame = function(execName, mainPack, extraArgs) {
		// Start and init with execName as loadPath if not inited.
		executableName = execName;
		var me = this;
		return Promise.all([
			this.init(execName),
			this.preloadFile(mainPack, mainPack)
		]).then(function() {
			var args = [ '--main-pack', mainPack ];
			if (extraArgs)
				args = args.concat(extraArgs);
			return me.start.apply(me, args);
		});
	};

	Engine.prototype.setWebAssemblyFilenameExtension = function(override) {
		if (String(override).length === 0) {
			throw new Error('Invalid WebAssembly filename extension override');
		}
		wasmExt = String(override);
	};

	Engine.prototype.setUnloadAfterInit = function(enabled) {
		unloadAfterInit = enabled;
	};

	Engine.prototype.setCanvas = function(canvasElem) {
		canvas = canvasElem;
	};

	Engine.prototype.setCanvasResizedOnStart = function(enabled) {
		resizeCanvasOnStart = enabled;
	};

	Engine.prototype.setLocale = function(locale) {
		customLocale = locale;
	};

	Engine.prototype.setExecutableName = function(newName) {
		executableName = newName;
	};

	Engine.prototype.setProgressFunc = function(func) {
		progressFunc = func;
	};

	Engine.prototype.setStdoutFunc = function(func) {
		var print = function(text) {
			if (arguments.length > 1) {
				text = Array.prototype.slice.call(arguments).join(" ");
			}
			func(text);
		};
		if (rtenv)
			rtenv.print = print;
		stdout = print;
	};

	Engine.prototype.setStderrFunc = function(func) {
		var printErr = function(text) {
			if (arguments.length > 1)
				text = Array.prototype.slice.call(arguments).join(" ");
			func(text);
		};
		if (rtenv)
			rtenv.printErr = printErr;
		stderr = printErr;
	};

	Engine.prototype.setBrowserFSConfig = function(config) {
		browserFSConfig = config;
	}

	// Closure compiler exported engine methods.
	/** @export */
	Engine['isWebGLAvailable'] = Utils.isWebGLAvailable;
	Engine['load'] = load;
	Engine['unload'] = unload;
	Engine.prototype['init'] = Engine.prototype.init;
	Engine.prototype['preloadFile'] = Engine.prototype.preloadFile;
	Engine.prototype['start'] = Engine.prototype.start;
	Engine.prototype['startGame'] = Engine.prototype.startGame;
	Engine.prototype['setWebAssemblyFilenameExtension'] = Engine.prototype.setWebAssemblyFilenameExtension;
	Engine.prototype['setUnloadAfterInit'] = Engine.prototype.setUnloadAfterInit;
	Engine.prototype['setCanvas'] = Engine.prototype.setCanvas;
	Engine.prototype['setCanvasResizedOnStart'] = Engine.prototype.setCanvasResizedOnStart;
	Engine.prototype['setLocale'] = Engine.prototype.setLocale;
	Engine.prototype['setExecutableName'] = Engine.prototype.setExecutableName;
	Engine.prototype['setProgressFunc'] = Engine.prototype.setProgressFunc;
	Engine.prototype['setStdoutFunc'] = Engine.prototype.setStdoutFunc;
	Engine.prototype['setStderrFunc'] = Engine.prototype.setStderrFunc;
	Engine.prototype['setBrowserFSConfig'] = Engine.prototype.setBrowserFSConfig;
	return Engine;
})();
