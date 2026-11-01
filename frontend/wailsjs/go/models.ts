export namespace main {
	
	export class Settings {
	    backupFolder: string;
	    keyConfigured: boolean;
	    lastBackup: string;
	    backupError: string;
	    dataFolder: string;
	    theme: string;
	    autostart: boolean;
	    autostartSupported: boolean;
	    autostartError: string;
	    notificationError: string;
	
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
	        this.autostart = source["autostart"];
	        this.autostartSupported = source["autostartSupported"];
	        this.autostartError = source["autostartError"];
	        this.notificationError = source["notificationError"];
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
	export class Notification {
	    id: string;
	    taskId: string;
	    taskTitle: string;
	    taskStart: string;
	    dueAt: string;
	    createdAt: string;
	    sound: boolean;
	    read: boolean;
	    occurrenceDate?: string;
	
	    static createFrom(source: any = {}) {
	        return new Notification(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.taskId = source["taskId"];
	        this.taskTitle = source["taskTitle"];
	        this.taskStart = source["taskStart"];
	        this.dueAt = source["dueAt"];
	        this.createdAt = source["createdAt"];
	        this.sound = source["sound"];
	        this.read = source["read"];
	        this.occurrenceDate = source["occurrenceDate"];
	    }
	}
	export class Occurrence {
	    id: string;
	    taskId: string;
	    date: string;
	    start: string;
	    end: string;
	    done: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Occurrence(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.taskId = source["taskId"];
	        this.date = source["date"];
	        this.start = source["start"];
	        this.end = source["end"];
	        this.done = source["done"];
	    }
	}
	export class Recurrence {
	    weekdays: number[];
	    timeZone: string;
	    until: string;
	
	    static createFrom(source: any = {}) {
	        return new Recurrence(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.weekdays = source["weekdays"];
	        this.timeZone = source["timeZone"];
	        this.until = source["until"];
	    }
	}
	export class Reminder {
	    id: string;
	    kind: string;
	    minutesBefore: number;
	    at: string;
	    sound: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Reminder(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.kind = source["kind"];
	        this.minutesBefore = source["minutesBefore"];
	        this.at = source["at"];
	        this.sound = source["sound"];
	    }
	}
	export class TaskException {
	    date: string;
	    done: boolean;
	    skipped: boolean;
	    start: string;
	    end: string;
	
	    static createFrom(source: any = {}) {
	        return new TaskException(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.date = source["date"];
	        this.done = source["done"];
	        this.skipped = source["skipped"];
	        this.start = source["start"];
	        this.end = source["end"];
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
	    reminders: Reminder[];
	    recurrence?: Recurrence;
	    exceptions?: TaskException[];
	
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
	        this.reminders = this.convertValues(source["reminders"], Reminder);
	        this.recurrence = this.convertValues(source["recurrence"], Recurrence);
	        this.exceptions = this.convertValues(source["exceptions"], TaskException);
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

