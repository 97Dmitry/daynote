export namespace main {
	
	export class Settings {
	    backupFolder: string;
	    keyConfigured: boolean;
	    lastBackup: string;
	    backupError: string;
	    dataFolder: string;
	    theme: string;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.backupFolder = source["backupFolder"];
	        this.keyConfigured = source["keyConfigured"];
	        this.lastBackup = source["lastBackup"];
	        this.backupError = source["backupError"];
	        this.dataFolder = source["dataFolder"];
	        this.theme = source["theme"];
	    }
	}

}

export namespace store {
	
	export class Note {
	    id: string;
	    title: string;
	    body: string;
	    date: string;
	    topicId: string;
	    pinned: boolean;
	    position: number;
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new Note(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.body = source["body"];
	        this.date = source["date"];
	        this.topicId = source["topicId"];
	        this.pinned = source["pinned"];
	        this.position = source["position"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class Task {
	    id: string;
	    title: string;
	    description: string;
	    start: string;
	    end: string;
	    color: string;
	    done: boolean;
	    noteIds: string[];
	
	    static createFrom(source: any = {}) {
	        return new Task(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.start = source["start"];
	        this.end = source["end"];
	        this.color = source["color"];
	        this.done = source["done"];
	        this.noteIds = source["noteIds"];
	    }
	}
	export class Topic {
	    id: string;
	    name: string;
	    color: string;
	    position: number;
	
	    static createFrom(source: any = {}) {
	        return new Topic(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.color = source["color"];
	        this.position = source["position"];
	    }
	}
	export class Snapshot {
	    version: number;
	    topics: Topic[];
	    notes: Note[];
	    tasks: Task[];
	
	    static createFrom(source: any = {}) {
	        return new Snapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.topics = this.convertValues(source["topics"], Topic);
	        this.notes = this.convertValues(source["notes"], Note);
	        this.tasks = this.convertValues(source["tasks"], Task);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	

}

