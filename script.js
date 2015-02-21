var renderer, scene, camera, meshes = [];
var censusData = d3.map();
var counties;

var RO_CENTER = [45.9442858, 25.0094303];
var MAX_EXTRUSION = 10;

var years = [];

var WIDTH = window.innerWidth, HEIGHT = window.innerHeight,
	NEAR = 0.1, FAR = 10000,
	VIEW_ANGLE = 45;

function getPopulation(countyCode, year) {
	return censusData.get(countyCode).get(year);
}

// function that maps population int to extrusion value
// requires the maximum possible population
var getExtrusion;

// function that maps population int to luminance
// requires the maximum possible population
var getLuminance;

function initThree() {
	renderer = new THREE.WebGLRenderer();
	renderer.setSize(WIDTH, HEIGHT);
	document.getElementById('chart').appendChild(renderer.domElement);

	scene = new THREE.Scene();

	camera = new THREE.PerspectiveCamera(VIEW_ANGLE, WIDTH / HEIGHT, NEAR, FAR);
	camera.position.x = 0;
	camera.position.y = 45;
	camera.position.z = 0;
	restoreCameraOrientation(camera);
	scene.add(camera);

	// DEBUG: add a cube, for reference
	var geometry = new THREE.BoxGeometry(1, 1, 1);
	var material = new THREE.MeshBasicMaterial({color: 0x0000ff});
	var cube = new THREE.Mesh(geometry, material);
	scene.add(cube);

	// add a light at a specific position
	var pointLight = new THREE.PointLight(0xFFFFFF);
	scene.add(pointLight);
	pointLight.position.x = 800;
	pointLight.position.y = 800;
	pointLight.position.z = 800;

	// add a base plane on which we'll render our map
	// var planeGeo = new THREE.PlaneBufferGeometry(10000, 10000, 10, 10);
	// var planeMat = new THREE.MeshLambertMaterial({color: 0x666699});
	// var plane = new THREE.Mesh(planeGeo, planeMat);

	// rotate it to correct position
	// plane.rotation.x = -Math.PI/2;
	// scene.add(plane);

	controls = new THREE.TrackballControls(camera, renderer.domElement);
	controls.minDistance = 10;
	controls.maxDistance = 50;

	animate();
}

function render() {
	renderer.render(scene, camera);
}

function animate() {
	controls.update();
	render();

	requestAnimationFrame(animate);
}

function saveCameraOrientation() {
	sessionStorage.setItem('camera.position', JSON.stringify(camera.position.toArray()));
	sessionStorage.setItem('camera.quarternion', JSON.stringify(camera.quarternion.toArray()));
}

function restoreCameraOrientation() {
	['position', 'quarternion'].forEach(function (key) {
		var val = JSON.parse(sessionStorage.getItem('camera.' + key));
		if (val) {
			camera[key].fromArray(val);
		}

		console.log('restored ' + key);
	});
}

function initGeometry(features) {
	var path = d3.geo.path().projection(d3.geo.mercator().center(RO_CENTER));

	return features.map(function(feature) {
		var flatGeometry = transformSVGPath(path(feature));

		return {
			id: feature.id,
			name: feature.properties.name,
			geometry: flatGeometry
		}
	});
}

function renderPopulation(year) {
	// remove curren meshes
	meshes.forEach(function(mesh) {
		scene.remove(mesh);
	});

	meshes = counties.map(function(county) {
		var population = getPopulation(county.id, year);
		var extrusion = getExtrusion(population);
		var color = d3.hsl(105, 0.9, getLuminance(population)).toString();

		var extrudeMaterial = new THREE.MeshLambertMaterial({color: color}); 
		var faceMaterial = new THREE.MeshBasicMaterial({color: color});

		var geometry = county.geometry.extrude({
			amount: extrusion,
			bevelEnabled: false,
			extrudeMaterial: 0,
			material: 1
		});

		var mesh = new THREE.Mesh(geometry, new THREE.MeshFaceMaterial(
			[extrudeMaterial, faceMaterial]));

		// rotate and position the elements nicely in the center
		mesh.rotateX(Math.PI/2);
		mesh.rotateZ(-1.60);
		mesh.translateX(-425);
		mesh.translateY(-183);
		mesh.translateZ(-extrusion);

		scene.add(mesh);

		return mesh;
	});
}

function loadData(sources, callback) {
	var remaining = sources.length;
	var results = {}

	sources.forEach(function(source) {
		function handler(error, data) {
			if (error) throw error;

			results[source.key] = data;

			remaining--;

			if (!remaining) {
				callback(results);
			}
		}

		args = source.args.slice();
		args.push(handler);
		d3[source.type].apply(d3, args);
	});
}

initThree();

var dataSources = [
	{type: 'json', args: ['data/romania-topo.json'], key: 'judete'},
	{type: 'json', args: ['data/judete-id.json'], key: 'id_judete'},
	{type: 'csv', args: ['data/recensaminte.csv'], key: 'recensaminte'}
];

function extractYears(recensaminte) {
	return Object.keys(recensaminte[0]).filter(function(key) {
		return key !== 'name';
	}).map(function(year) {
		return parseInt(year, 10);
	});
}

function prepareCensusData(recensaminte, id_judete) {
	var max_population = 0;
	var year_sums = {};

	recensaminte.forEach(function(row) {
		var countyCode = id_judete[row.name];

		var datum = d3.map();

		years.forEach(function(year) {
			var value = parseInt(row[year], 10);

			datum.set(year, value);

			if (value > max_population) {
				max_population = value;
			}
		});

		censusData.set(countyCode, datum);
	});

	return max_population;
}

loadData(dataSources, function(results) {
	years = extractYears(results.recensaminte);
	var max_population = prepareCensusData(results.recensaminte, results.id_judete);

	getExtrusion = d3.scale.linear().domain([0, max_population]).range([0, MAX_EXTRUSION]);
	getLuminance = d3.scale.linear().domain([0, max_population]);

	var judete = results.judete;

	var features = topojson.feature(judete, judete.objects['romania-counties-geojson']).features;
	counties = initGeometry(features);

	var yearSelect = jQuery('#current-year');

	yearSelect.append(years.map(function(year) {
		return jQuery('<button type="button" class="btn btn-default">').html(year);
	}));

	yearSelect.on('click', 'button', function(ev) {
		var $this = jQuery(this);

		var year = parseInt($this.html(), 10);

		renderPopulation(year);

		yearSelect.find('button').removeClass('active');
		$this.addClass('active');
	});

	yearSelect.find('button')[0].click();
});

window.onbeforeunload = saveCameraOrientation;
