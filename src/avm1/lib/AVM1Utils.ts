/**
 * Copyright 2014 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

///<reference path='../references.ts' />

module Shumway.AVM1.Lib {
  import ASObject = Shumway.AVMX.AS.ASObject;
  import flash = Shumway.AVMX.AS.flash;
  import AXClass = Shumway.AVMX.AXClass;

  export interface IAVM1SymbolBase {
    isAVM1Instance: boolean;
    as3Object: flash.display.DisplayObject;
    context: AVM1Context;
    initAVM1SymbolInstance(context: AVM1Context, as3Object: flash.display.DisplayObject);
    updateAllEvents();
  }

  export class AVM1EventHandler {
    constructor(public propertyName: string,
                public eventName: string,
                public argsConverter: Function = null) { }

    public onBind(target: IAVM1SymbolBase): void {}
    public onUnbind(target: IAVM1SymbolBase): void {}
  }

  function normalizeEventName(context: AVM1Context, eventName: string): string {
    return context.isPropertyCaseSensitive ? eventName : eventName.toLowerCase();
  }

  // TODO replace to AVM1NativeSymbolObject
  export class AVM1SymbolBase<T extends flash.display.DisplayObject> extends AVM1Object implements IAVM1SymbolBase, IAVM1EventPropertyObserver {
    public get isAVM1Instance(): boolean {
      return !!this._as3Object;
    }

    _as3Object: T;

    public get as3Object(): T {
      return this._as3Object;
    }

    public initAVM1SymbolInstance(context: AVM1Context, as3Object: T) {
      AVM1Object.call(this, context);

      release || Debug.assert(as3Object);
      this._as3Object = as3Object;
    }

    private _eventsMap: MapObject<AVM1EventHandler>;
    private _events: AVM1EventHandler[];
    private _eventsListeners: MapObject<Function>;

    public bindEvents(events: AVM1EventHandler[], autoUnbind: boolean = true) {
      this._events = events;
      var eventsMap = Object.create(null);
      this._eventsMap = eventsMap;
      this._eventsListeners = Object.create(null);
      var observer = this;
      var context: AVM1Context = (<any>this).context;
      events.forEach(function (event: AVM1EventHandler) {
        var propertyName = normalizeEventName(context, event.propertyName);
        eventsMap[propertyName] = event;
        context.registerEventPropertyObserver(propertyName, observer);
        observer._updateEvent(event);
      });

      if (autoUnbind) {
        observer.as3Object.addEventListener('removedFromStage', function removedHandler() {
          observer.as3Object.removeEventListener('removedFromStage', removedHandler);
          observer.unbindEvents();
        });
      }
    }

    public unbindEvents() {
      var events = this._events;
      var observer = this;
      var context = this.context;
      events.forEach(function (event: AVM1EventHandler) {
        context.unregisterEventPropertyObserver(event.propertyName, observer);
        observer._removeEventListener(event);
      });
      this._events = null;
      this._eventsMap = null;
      this._eventsListeners = null;
    }

    public updateAllEvents() {
      this._events.forEach(function (event: AVM1EventHandler) {
        this._updateEvent(event);
      }, this)
    }

    private _updateEvent(event: AVM1EventHandler) {
      if (avm1HasEventProperty(this.context, this, event.propertyName)) {
        this._addEventListener(event);
      } else {
        this._removeEventListener(event);
      }
    }

    private _addEventListener(event: AVM1EventHandler) {
      var propertyName = normalizeEventName(this.context, event.propertyName);
      var listener: any = this._eventsListeners[propertyName];
      if (!listener) {
        listener = function avm1EventHandler() {
          var args = event.argsConverter ? event.argsConverter.apply(null, arguments) : null;
          avm1BroadcastNativeEvent(this.context, this, propertyName, args);
        }.bind(this);
        this.as3Object.addEventListener(event.eventName, listener);
        event.onBind(this);
        this._eventsListeners[propertyName] = listener;
      }
    }

    private _removeEventListener(event: AVM1EventHandler) {
      var propertyName = normalizeEventName(this.context, event.propertyName);
      var listener: any = this._eventsListeners[propertyName];
      if (listener) {
        event.onUnbind(this);
        this.as3Object.removeEventListener(event.eventName, listener);
        this._eventsListeners[propertyName] = null;
      }
    }

    public onEventPropertyModified(propertyName: string) {
      var propertyName = normalizeEventName(this.context, propertyName);
      var event = this._eventsMap[propertyName];
      this._updateEvent(event);
    }
  }

  export function avm1HasEventProperty(context: AVM1Context, target: any, propertyName: string): boolean {
    if (target.alHasProperty(propertyName) &&
        (target.alGet(propertyName) instanceof AVM1Function)) {
      return true;
    }
    var listenersField = target.alGet('_listeners');
    if (!(listenersField instanceof Natives.AVM1ArrayNative)) {
      return false;
    }
    var listeners: any[] = listenersField.value;
    return listeners.some(function (listener) {
      return (listener instanceof AVM1Object) && listener.alHasProperty(propertyName);
    });
  }

  function avm1BroadcastNativeEvent(context: AVM1Context, target: any, propertyName: string, args: any[] = null): void {
    var handler: AVM1Function = target.alGet(propertyName);
    if (handler instanceof AVM1Function) {
      context.executeFunction(handler, target, args);
    }
    var _listeners = target.alGet('_listeners');
    if (_listeners instanceof Natives.AVM1ArrayNative) {
      _listeners.value.forEach(function (listener) {
        if (!(listener instanceof AVM1Object)) {
          return;
        }
        var handlerOnListener: AVM1Function = listener.alGet(propertyName);
        if (handlerOnListener instanceof AVM1Function) {
          context.executeFunction(handlerOnListener, target, args);
        }
      });
    }
  }

  export function avm1BroadcastEvent(context: AVM1Context, target: any, propertyName: string, args: any[] = null): void {
    var handler: AVM1Function = target.alGet(propertyName);
    if (handler instanceof AVM1Function) {
      handler.alCall(target, args);
    }
    var _listeners = target.alGet('_listeners');
    if (_listeners instanceof Natives.AVM1ArrayNative) {
      _listeners.value.forEach(function (listener) {
        if (!(listener instanceof AVM1Object)) {
          return;
        }
        var handlerOnListener: AVM1Function = listener.alGet(propertyName);
        if (handlerOnListener instanceof AVM1Function) {
          handlerOnListener.alCall(target, args);
        }
      });
    }
  }

  export class AVM1Utils {
    static resolveTarget<T extends IAVM1SymbolBase>(context: AVM1Context, target_mc: any = undefined): any {
      return context.resolveTarget(target_mc);
    }

    // Temporary solution as suggested by Yury. Will be refactored soon.
    static resolveMovieClip<T extends IAVM1SymbolBase>(context: AVM1Context, target: any = undefined): any {
      return target ? context.resolveTarget(target) : undefined;
    }

    static resolveLevel(context: AVM1Context, level: number): AVM1MovieClip {
      level = +level;
      return context.resolveLevel(level);
    }

    public static getTarget(mc: IAVM1SymbolBase) {
      var nativeObject = mc.as3Object;
      if (nativeObject === nativeObject.root) {
        return '/';
      }
      var path = '';
      do {
        path = '/' + nativeObject.name + path;
        nativeObject = nativeObject.parent;
      } while (nativeObject !== nativeObject.root);
      return path;
    }
  }

  function createAVM1NativeObject(ctor, nativeObject: flash.display.DisplayObject, context: AVM1Context) {
    // We need to walk on __proto__ to find right ctor.prototype.
    var proto = ctor.alGetPrototypeProperty();
    while (proto && !(<any>proto).initAVM1SymbolInstance) {
      proto = proto.alPrototype;
    }
    release || Debug.assert(proto);
    var avm1Object = Object.create(proto);
    (<any>proto).initAVM1SymbolInstance.call(avm1Object, context, nativeObject);
    avm1Object.alPrototype = ctor.alGetPrototypeProperty();
    avm1Object.alSetOwnConstructorProperty(ctor);
    (<any>nativeObject)._as2Object = avm1Object;
    ctor.alCall(avm1Object);
    return avm1Object;
  }

  export function getAVM1Object(as3Object, context: AVM1Context): AVM1Object {
    if (!as3Object) {
      return null;
    }
    if (as3Object._as2Object) {
      return as3Object._as2Object;
    }
    var sec = context.sec;
    if (sec.flash.display.MovieClip.axClass.axIsType(as3Object)) {
      if (<flash.display.MovieClip>as3Object._avm1SymbolClass) {
        return createAVM1NativeObject(<flash.display.MovieClip>as3Object._avm1SymbolClass, as3Object, context);
      }
      return createAVM1NativeObject(context.globals.MovieClip, as3Object, context);
    }
    if (sec.flash.display.SimpleButton.axClass.axIsType(as3Object)) {
      return createAVM1NativeObject(context.globals.Button, as3Object, context);
    }
    if (sec.flash.text.TextField.axClass.axIsType(as3Object)) {
      return createAVM1NativeObject(context.globals.TextField, as3Object, context);
    }
    if (sec.flash.display.BitmapData.axClass.axIsType(as3Object)) {
      return new as3Object;
    }

    return null;
  }

  export function wrapAVM1NativeMembers(context: AVM1Context, wrap: AVM1Object, obj: any, members: string[], prefixFunctions: boolean = false): void  {
    function wrapFunction(fn) {
      if (isNullOrUndefined(fn)) {
        return undefined;
      }
      release || Debug.assert(typeof fn === 'function');
      if (!prefixFunctions) {
        return new AVM1NativeFunction(context, fn);
      }
      return new AVM1NativeFunction(context, function () {
        var args = Array.prototype.slice.call(arguments, 0);
        args.unshift(context);
        return fn.apply(this, args);
      });
    }
    function getMemberDescriptor(memberName): PropertyDescriptor {
      var desc;
      for (var p = obj; p; p = Object.getPrototypeOf(p)) {
        desc = Object.getOwnPropertyDescriptor(p, memberName);
        if (desc) {
          return desc;
        }
      }
      return null;
    }

    if (!members) {
      return;
    }
    members.forEach(function (memberName) {
      if (memberName[memberName.length - 1] === '#') {
        // Property mapping
        var getterName = 'get' + memberName[0].toUpperCase() + memberName.slice(1, -1);
        var getter = obj[getterName];
        var setterName = 'set' + memberName[0].toUpperCase() + memberName.slice(1, -1);
        var setter = obj[setterName];
        release || Debug.assert(getter || setter, 'define getter or setter')
        wrap.alSetOwnProperty(memberName.slice(0, -1), {
          flags: AVM1PropertyFlags.ACCESSOR | AVM1PropertyFlags.DONT_DELETE | AVM1PropertyFlags.DONT_ENUM,
          get: wrapFunction(getter),
          set: wrapFunction(setter)
        })
        return;
      }

      var desc = getMemberDescriptor(memberName);
      if (!desc) {
        return;
      }
      if (desc.get || desc.set) {
        release || Debug.assert(false, 'Redefine ' + memberName + ' property getter/setter as functions');
        return;
      }

      var value = desc.value;
      if (typeof value === 'function') {
        value = wrapFunction(value);
      }
      wrap.alSetOwnProperty(memberName, {
        flags: AVM1PropertyFlags.DATA | AVM1PropertyFlags.DONT_DELETE | AVM1PropertyFlags.DONT_ENUM,
        value: value
      })
    });
  }

  export function wrapAVM1NativeClass(context: AVM1Context, wrapAsFunction: boolean, cls: typeof AVM1Object, staticMembers: string[], members: string[], call?: Function, cstr?: Function): AVM1Object  {
    var wrappedFn = wrapAsFunction ?
      new AVM1NativeFunction(context, call || function () { }, function () {
        // Creating simple AVM1 object
        var obj = new cls(context);
        obj.alPrototype = wrappedPrototype;
        obj.alSetOwnConstructorProperty(wrappedFn);
        if (cstr) {
          cstr.apply(obj, arguments);
        }
        return obj;
      }) :
      new AVM1Object(context);
    wrapAVM1NativeMembers(context, wrappedFn, cls, staticMembers, true);
    var wrappedPrototype = new cls(context);
    wrappedPrototype.alPrototype = context.builtins.Object.alGetPrototypeProperty();
    wrapAVM1NativeMembers(context, wrappedPrototype, cls.prototype, members, false);
    alDefineObjectProperties(wrappedFn, {
      prototype: {
        value: wrappedPrototype
      }
    });
    alDefineObjectProperties(wrappedPrototype, {
      constructor: {
        value: wrappedFn,
        writable: true
      }
    });
    return wrappedFn;
  }

  // TODO: type arguments strongly
  export function initializeAVM1Object(as3Object: any,
                                       context: AVM1Context,
                                       placeObjectTag: any) {
    var instanceAVM1 = getAVM1Object(as3Object, context);
    release || Debug.assert(instanceAVM1);

    if (placeObjectTag.variableName) {
      instanceAVM1.alPut('variable', placeObjectTag.variableName);
    }

    var events = placeObjectTag.events;
    if (!events) {
      return;
    }
    var stageListeners = [];
    var as3Stage = (<any>context.globals.Stage)._as3Stage;
    for (var j = 0; j < events.length; j++) {
      var swfEvent = events[j];
      var actionsData;
      if (swfEvent.actionsData) {
        actionsData = context.actionsDataFactory.createActionsData(
          swfEvent.actionsData, 's' + placeObjectTag.symbolId + 'e' + j);
        swfEvent.actionsData = null;
        swfEvent.compiled = actionsData;
      } else {
        actionsData = swfEvent.compiled;
      }
      release || Debug.assert(actionsData);
      var handler = clipEventHandler.bind(null, actionsData, instanceAVM1);
      var flags = swfEvent.flags;
      for (var eventFlag in ClipEventMappings) {
        eventFlag |= 0;
        if (!(flags & (eventFlag | 0))) {
          continue;
        }
        var eventName = ClipEventMappings[eventFlag];
        if (eventName === 'mouseDown' || eventName === 'mouseUp' || eventName === 'mouseMove') {
          stageListeners.push({eventName: eventName, handler: handler});
          as3Stage.addEventListener(eventName, handler);
        } else {
          // AVM1 MovieClips are set to button mode if one of the button-related event listeners is
          // set. This behaviour is triggered regardless of the actual value they are set to.
          switch (eventFlag) {
            case AVM1ClipEvents.Release:
            case AVM1ClipEvents.ReleaseOutside:
            case AVM1ClipEvents.RollOver:
            case AVM1ClipEvents.RollOut:
              as3Object.buttonMode = true;
          }
          as3Object.addEventListener(eventName, handler);
        }
      }
    }
    if (stageListeners.length > 0) {
      as3Object.addEventListener('removedFromStage', function () {
        for (var i = 0; i < stageListeners.length; i++) {
          as3Stage.removeEventListener(stageListeners[i].eventName, stageListeners[i].fn, false);
        }
      }, false);
    }
  }

  function clipEventHandler(actionsData: AVM1.AVM1ActionsData,
                            receiver: IAVM1SymbolBase) {
    return receiver.context.executeActions(actionsData, receiver);
  }

  import AVM1ClipEvents = SWF.Parser.AVM1ClipEvents;
  var ClipEventMappings = Object.create(null);
  ClipEventMappings[AVM1ClipEvents.Load] = 'load';
  // AVM1's enterFrame happens at the same point in the cycle as AVM2's frameConstructed.
  ClipEventMappings[AVM1ClipEvents.EnterFrame] = 'frameConstructed';
  ClipEventMappings[AVM1ClipEvents.Unload] = 'unload';
  ClipEventMappings[AVM1ClipEvents.MouseMove] = 'mouseMove';
  ClipEventMappings[AVM1ClipEvents.MouseDown] = 'mouseDown';
  ClipEventMappings[AVM1ClipEvents.MouseUp] = 'mouseUp';
  ClipEventMappings[AVM1ClipEvents.KeyDown] = 'keyDown';
  ClipEventMappings[AVM1ClipEvents.KeyUp] = 'keyUp';
  ClipEventMappings[AVM1ClipEvents.Data] = {toString: function() {Debug.warning('Data ClipEvent not implemented');}};
  ClipEventMappings[AVM1ClipEvents.Initialize] = 'initialize';
  ClipEventMappings[AVM1ClipEvents.Press] = 'mouseDown';
  ClipEventMappings[AVM1ClipEvents.Release] = 'click';
  ClipEventMappings[AVM1ClipEvents.ReleaseOutside] = 'releaseOutside';
  ClipEventMappings[AVM1ClipEvents.RollOver] = 'mouseOver';
  ClipEventMappings[AVM1ClipEvents.RollOut] = 'mouseOut';
  ClipEventMappings[AVM1ClipEvents.DragOver] = {toString: function() {Debug.warning('DragOver ClipEvent not implemented');}};
  ClipEventMappings[AVM1ClipEvents.DragOut] =  {toString: function() {Debug.warning('DragOut ClipEvent not implemented');}};
  ClipEventMappings[AVM1ClipEvents.KeyPress] =  {toString: function() {Debug.warning('KeyPress ClipEvent not implemented');}};
  ClipEventMappings[AVM1ClipEvents.Construct] =  'construct';

}
