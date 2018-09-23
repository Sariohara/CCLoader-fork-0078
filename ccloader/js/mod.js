const fs = require('fs');
const path = require('path');
const process = require('process');

export class Mod {
	/**
	 * 
	 * @param {Modloader} modloader
	 * @param {string} file 
	 * @param {string} ccVersion
	 */
	constructor(modloader, file, ccVersion){
		this.file = file;
		this.filemanager = modloader.filemanager;
		this.ccVersion = ccVersion;

		const data = this.filemanager.getResource(file);
		if(!data)
			return;
		
		/** @type {{name: string, version?: string, description?: string, main?: string, table?: string, assets: string[], dependencies: {[key: string]: string}}} */
		this.manifest = JSON.parse(data);
		if(!this.manifest)
			return;
		
		if(this.manifest.main){
			if(!this._isPathAbsolute(this.manifest.main)) {
				this.manifest.main = this._getBaseName(file) + '/' + this.manifest.main;
			}
			this.manifest.main = this._normalizePath(this.manifest.main);
		}
		
		if(this.manifest.table){
			if(!this._isPathAbsolute(this.manifest.table)) {
				this.manifest.table = this._getBaseName(file) + '/' + this.manifest.table;
			}
			this.manifest.table = this._normalizePath(this.manifest.table);
		}
		
		if(!this.manifest.name) {
			this.manifest.name = this._getModNameFromFile();
		}
		
		this._findAssets(this._getBaseName(file) + '/assets/').then(data => {
			this.manifest.assets = data;
			this.loaded = true;
			if(this.onloaded) {
				this.onloaded();
			}
		});
	}

	/**
	 * @returns {Promise<void>}
	 */
	load() {
		return new Promise((resolve, reject) => {
			if(!this.loaded)
				return reject();
	
			if(!this.manifest.main)
				return resolve();
	
			this.filemanager.loadMod(this.manifest.main)
				.then(() => resolve())
				.catch(() => reject());
		});
	}

	/**
	 * @returns {Promise<void>}
	 */
	onload() {
		return new Promise(resolve => {
			if(this.loaded) {
				resolve();
			} else {
				this.onloaded = () => resolve();
			}
		});
	}

	get name() {
		if(!this.loaded)
			return undefined;
		
		return this.manifest.name;
	}
	get description(){
		if(!this.loaded)
			return undefined;
		
		return this.manifest.description;
	}
	get assets(){
		if(!this.loaded)
			return undefined;
		return this.manifest.assets;
	}
	get dependencies(){
		if(!this.loaded)
			return undefined;
		return this.manifest.dependencies;
	}
	get version(){
		if(!this.loaded)
			return undefined;
		return this.manifest.version;
	}

	/**
	 * 
	 * @param {string} path 
	 */
	getAsset(path){
		if(!this.loaded || !this.manifest.assets)
			return;

		path = path.replace(/\\/g, '/');

		if(this.runtimeAssets && this.runtimeAssets[path]) {
			return this.runtimeAssets;
		}

		for(const asset of this.assets) {
			if(asset.endsWith(path)) {
				return asset;
			}
		}
	}
	/**
	 * 
	 * @param {string} original 
	 * @param {string} newPath 
	 */
	setAsset(original, newPath){
		this.runtimeAssets[original] = newPath;
	}
	get baseDirectory(){
		return this._getBaseName(this.file).replace(/\\/g, '/').replace(/\/\//g, '/') + '/';
	}

	/**
	 * @param {ModLoader} ccloader
	 */
	initializeTable(ccloader){
		if(!this.loaded || !this.manifest.table)
			return;
		
		const hash = this.filemanager.getModDefintionHash(this.manifest.table);
		const tablePath = path.join(this._getBaseName(this.file), hash);
			
		this.table = this.filemanager.loadTable(tablePath, hash);
		if(!this.table){
			console.log('[' + this.manifest.name + '] Creating mod definition database..');
			if(ccloader.acorn.needsParsing) {
				console.log('[' + this.manifest.name + '] Parsing...');
				const jscode = this.filemanager.getResource('assets/js/game.compiled.js');
				ccloader.acorn.parse(jscode);
			}
			const dbtext = this.filemanager.getResource('assets/' + this.manifest.table);
			const dbdef = JSON.parse(dbtext);
			console.log('[' + this.manifest.name + '] Analysing...');
			this.table = ccloader.acorn.analyse(dbdef);
			console.log('[' + this.manifest.name + '] Writing...');
			this.filemanager.saveTable(tablePath, this.table, hash);
			console.log('[' + this.manifest.name + '] Finished!');
		}
	}

	/**
	 * @param {ModLoader} ccloader
	 */
	executeTable(ccloader){
		if(!this.loaded || !this.table)
			return;

		this.table.execute(ccloader._getGameWindow(), ccloader._getGameWindow());
	}

	get isEnabled(){
		if(!this.loaded)
			return false;
		
		try {
			const globals = window['frame'].contentWindow.cc.ig.storage[window.frame.contentWindow.cc.ig.varNames.storageGlobals];
			
			if(!globals || !globals.options)
				return true;
			
			return globals.options['modEnabled-' + this.manifest.name.toLowerCase()] !== false;
		} catch (err) {
			console.error(`An error occured while accessing the games internal storage. Disabling mod "${this.name}"`, err);
			return false;
		}
	}
	
	_getModNameFromFile(){
		let name = this.file.match(/\/[^/]*\/package.json/g).pop().replace(/\//g, '');
		name = name.substr(0, name.length - 6);
		return name;
	}
	/**
	 * 
	 * @param {string} path 
	 */
	_isPathAbsolute(path){
		return /^(?:\/|[a-z]+:\/\/)/.test(path);
	}
	/**
	 * 
	 * @param {string} path 
	 */
	_getBaseName(path){
		if(path.indexOf('/') >= 0)
			return path.substring(0, path.lastIndexOf('/'));
		else if(path.indexOf('\\') >= 0)
			return path.substring(0, path.lastIndexOf('\\'));
		else
			return path;
	}
	/**
	 * 
	 * @param {string} path 
	 */
	_normalizePath(path){
		if(path.replace(/\\/g, '/').indexOf('assets/') == 0)
			return path.substr(7);
		else
			return path;
	}
	/**
	 * 
	 * @param {string} dir 
	 */
	_findAssets(dir){
		return new Promise(resolve => {
			if(!this.manifest.assets && fs && path){
				/** @type {string[]} */
				let result = [];
				
				fs.readdir(dir, (err, files) => {
					if (err) {
						return resolve(result);
					}
		
					let count = files.length;
		
					if (count == 0) {
						return resolve(result);
					}
		
					for (let file of files){
						file = path.resolve(dir, file);
		
						(file => {
							fs.stat(file, (err, stat) => {				//TODO: simplify this mess
								if (err) {
									return resolve(result);
								}

								if(stat && stat.isDirectory()){
									this._findAssets(file).then(res => {
										result = result.concat(res);
										count--;
										if(count == 0)
											return resolve(result);
									});
								} else {
									if(file.endsWith('.json') || file.endsWith('.json.patch') || file.endsWith('.png'))
										result.push(path.relative(process.cwd() + '/assets/', file).replace(/\\/g, '/'));
									count--;
									if(count == 0)
										return resolve(result);
								}
							});
						})(file);
					}
				});
			} else {
				if(!this.manifest.assets)
					return resolve([]);
	
				let dir = this._getBaseName(this.file) + '/';
	
				const result = [];
				for(const asset of this.manifest.assets) {
					result.push(dir + asset);
				}
				return resolve(result);
			}
		});
	}
}
