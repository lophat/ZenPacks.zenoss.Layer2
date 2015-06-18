/*****************************************************************************
 *
 * Copyright (C) Zenoss, Inc. 2014, 2015 all rights reserved.
 *
 * This content is made available according to terms specified in
 * License.zenoss under the directory where your Zenoss product is installed.
 *
 ****************************************************************************/

"use strict";

(function(){
    window.form_panel = {}; 

    var show_error = Zenoss.flares.Manager.error;

    var get_checked_layers = function () {
        // build a comma-separated list of checked layers
        var records = Ext.getCmp('layers_group').getView().getChecked(),
            layers = [];

        Ext.Array.each(records, function(rec){
            layers.push(rec.get('value'));
        });

        return layers.join(',');
    };

    var parse_hash = function(hash) {
        var res = {
            'layers': '',
            'root_id': '',
            'depth': 2
        };
        if (hash) {
            var a = hash.split('&');
            if(
                (a[0].indexOf('deviceDetailNav') == 0) &&
                (a[0] != 'deviceDetailNav:network_map')
            ) return null; // not our panel
            for (var i in a) {
                var b = a[i].split('=');
                res[decodeURIComponent(b[0])] = decodeURIComponent(b[1]);
            }
        }
        return res;
    }

    var format_hash = function(data) {
        var res = ['deviceDetailNav:network_map'];
        Object.keys(data).forEach(function(key) {
            res.push(
                encodeURIComponent(key) +
                '=' +
                encodeURIComponent(data[key])
            );
        });
        return res.join('&');
    };

    var format_layers_data = function(checked_data) {
        var vlans = [],
            vxlans = [],
            obj = {},
            res = {
                "text": ".",
                "expanded": true,
                "children": []
            };

        Ext.Array.each(layers_options, function(rec){
            obj = {
                "text": rec.boxLabel,
                "value": rec.inputValue,
                "id": rec.id,
                "leaf": true,
                "checked": (checked_data.indexOf(rec.inputValue) > -1)
            }

            if (rec.boxLabel.indexOf('vlan') == 0) {
                obj.text = obj.text.replace(/vlan/gi, '');
                vlans.push(obj);
            } else if (rec.boxLabel.indexOf('vxlan') == 0) {
                obj.text = obj.text.replace(/vxlan/gi, '');
                vxlans.push(obj);
            } else {
                res.children.push(obj);
            }
        });

        if (vlans.length)
            res.children.push({
                "text": "VLANs",
                "children": vlans
            });

        if (vxlans.length)
            res.children.push({
                "text": "VXLANs",
                "children": vxlans
            });

        return res;
    }

    var click_node = function(data, right, x, y) {
        if(right) {
            show_context_menu(data, x, y, refresh_map);
        } else {
            if(data.path.indexOf('/zport/dmd/Devices/') == 0) {
                window.location.href = data.path;
            } else {
                show_error(data.path + ' is not a device.')
            };
        };
    };

    var layers_options;
    var on_layers_loaded = function (callback) {
        if (typeof layers_options === 'undefined') {
            Ext.Ajax.request({
                url: '/zport/dmd/getNetworkLayersList',
                success: function (response, request) {
                    layers_options = JSON.parse(response.responseText);
                    callback();
                },
                failure: function(error) {
                    show_error(error);
                }
            });
        } else {
            callback(); // we already have the data
        };
    };

    var refresh_map = function () {
        var params = sidebar.getValues();
        params.layers = get_checked_layers();

        // Updating URL
        var oldToken = Ext.History.getToken();
        var newToken = format_hash({
            root_id: params.root_id,
            depth: params.depth,
            layers: params.layers,
        });
        if (newToken !== oldToken) {
            Ext.History.add(newToken);
        };

        Ext.Ajax.request({
            url: '/zport/dmd/getJSONEdges',
            success: function (response, request) {
                var res = JSON.parse(response.responseText);
                if(res.error) {
                    return show_error(res.error);
                }
                var graph = graph_renderer('#' + map.body.id, click_node);
                graph.draw(res);
            },
            failure: function(error) {
                show_error(error);
            },
            params: params,
        });
    };

    var on_hash_change = function(hash) {
        var params = parse_hash(hash);
        if (params === null) return; // not our panel

        var layers = params.layers.split(',');

        on_layers_loaded(function () {
            Ext.getCmp('layers_group').store.setRootNode(format_layers_data(layers));
        });
        Ext.getCmp('sidebar_depth').setValue(params.depth);
        window.form_panel.change_root(params.root_id);
    };

    var sidebar = Ext.create('Ext.form.Panel', {
        id: 'network_map_form',
        width: 300,
        bodyPadding: 10,
        frame: true,
        defaultType: 'textfield',
        layout : {
            type: 'vbox',
            padding: 5,
            align: 'stretch',
        },
        items: [
            {
                id: 'sidebar_root_id',
                fieldLabel: 'Device ID',
                name: 'root_id',
                xtype: 'combo',
                valueField: 'name',
                displayField: 'name',
                store: new Ext.data.DirectStore({
                    directFn: Zenoss.remote.DeviceRouter.getDeviceUuidsByName,
                    root: 'data',
                    model: 'Zenoss.model.BasicUUID',
                    remoteFilter: true
                }),
                minChars: 3,
                typeAhead: false,
                hideLabel: true,
                hideTrigger: true,
                listConfig: {
                    loadingText: 'Searching...',
                    emptyText: 'No matching devices found.',
                },
                pageSize: 10
            }, {
                id: 'sidebar_depth',
                fieldLabel: 'Depth',
                name: 'depth',
                xtype: 'numberfield',
                value: 2,
                maxValue: 10,
                minValue: 1
            }, {
                xtype: 'treepanel',
                id: 'layers_group',
                store: new Ext.data.TreeStore({
                    proxy: {
                        type: 'memory'
                    },
                    root: format_layers_data([]),
                    folderSort: true,
                    model: new Ext.define('Layer', {
                        extend: 'Ext.data.Model',
                        fields: [
                            {name: 'id', type: 'string'},
                            {name: 'text', type: 'string'},
                            {name: 'value', type: 'string'}
                        ]
                    })
                }),
                title: 'Layers',
                flex: 1,
                overflowY: 'scroll',
                frame: true,
                rootVisible: false,
                displayField: 'text',
                useArrows: true
            }, {
                text: 'Apply',
                name: 'refresh_button',
                xtype: 'button',
                handler: refresh_map
            },
        ],
    });
    var map = Ext.create('Ext.panel.Panel', {
        flex: 1,
    });

    var hbox_center_panel = Ext.create('Ext.panel.Panel', {
        layout: {
            type: 'hbox',
            pack: 'start',
            align: 'stretch'
        },
    });

    window.form_panel.change_root = function(new_id) {
        Ext.getCmp('sidebar_root_id').setValue(new_id);
        refresh_map();
    };

    window.form_panel.render = function(panel) {
        Ext.History.init();
        Ext.History.on('change', on_hash_change);

        hbox_center_panel.add(sidebar);
        hbox_center_panel.add(map);
        hbox_center_panel.doLayout();

        panel.removeAll();
        panel.add(hbox_center_panel);
        panel.doLayout();

        on_hash_change(Ext.History.getToken());
    };

    var show_context_menu = (function () {
        var obj = {};
        var pin_down = Ext.create('Ext.menu.CheckItem', {
            text: 'Pin down',
            handler: function() {
                obj.data.fixed = this.checked;
            }
        });
        var show_inspector = function () {
            if(obj.data.path) {
                Zenoss.inspector.show(obj.data.path, obj.x, obj.y);
            };
        };
        var change_root = function () {
            window.form_panel.change_root(obj.data.path);
        };
        var menu = Ext.create('Ext.menu.Menu', {
            width: 140,
            items: [
                pin_down,
                {
                    text: 'Put map root here',
                    handler: change_root,
                },
                {
                    text: 'Device info',
                    handler: show_inspector,
                }
            ]
        });

        return (function (data, x, y, refresh_map) {
            obj.data = data;
            obj.x = x;
            obj.y = y;
            obj.refresh_map = refresh_map;
            pin_down.setChecked(data.fixed & 1);
            menu.showAt([x, y]);
        });
    })();

})();
