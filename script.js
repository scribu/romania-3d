var renderer, scene, camera;
var censusData = {};

var RO_CENTER = [45.9442858, 25.0094303];
var max_population = 0, MAX_EXTRUSION = -10;

// function that maps population int to extrusion value
// requires the maximum possible population
var getExtrusion;

var YEAR = 2002;  // DEBUG

var WIDTH = window.innerWidth, HEIGHT = window.innerHeight,
	NEAR = 0.1, FAR = 10000,
	VIEW_ANGLE = 45;

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
	var geometry = new THREE.BoxGeometry( 1, 1, 1 );
	var material = new THREE.MeshBasicMaterial( { color: 0xff0000 } );
	var cube = new THREE.Mesh( geometry, material );
	scene.add( cube );

	// add a light at a specific position
	var pointLight = new THREE.PointLight(0xFFFFFF);
	scene.add(pointLight);
	pointLight.position.x = 800;
	pointLight.position.y = 800;
	pointLight.position.z = 800;

	// add a base plane on which we'll render our map
	var planeGeo = new THREE.PlaneBufferGeometry(10000, 10000, 10, 10);
	var planeMat = new THREE.MeshLambertMaterial({color: 0x666699});
	var plane = new THREE.Mesh(planeGeo, planeMat);

	// rotate it to correct position
	plane.rotation.x = -Math.PI/2;
	scene.add(plane);

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

function getPopulation(countyCode, year) {
	return censusData[countyCode][year];
}

function renderTopography(features) {
	var path = d3.geo.path().projection(d3.geo.mercator().center(RO_CENTER));

	var counties = features.map(function(feature) {
		var mesh = transformSVGPath(path(feature));

		// create material color based on average
		// var scale = ((averageValues[i] - minValueAverage) / (maxValueAverage - minValueAverage)) * 255;
		// var mathColor = gradient(Math.round(scale),255);
		var material = new THREE.MeshLambertMaterial({
			// color: mathColor
			color: 0x00ff00
		});

		// create extrude based on total
		// var extrude = ((totalValues[i] - minValueTotal) / (maxValueTotal - minValueTotal)) * 100;
		var extrude = getExtrusion(getPopulation(feature.id, YEAR));

		var shape3d = mesh.extrude({amount: Math.round(extrude), bevelEnabled: false});

		// create a mesh based on material and extruded shape
		var toAdd = new THREE.Mesh(shape3d, material);

		// rotate and position the elements nicely in the center
		toAdd.rotateX(Math.PI/2);
		toAdd.rotateZ(-1.60);
		toAdd.translateX(-425);
		toAdd.translateY(-180 + extrude/2);

		// add to scene
		scene.add(toAdd);

		return {
			id: feature.id,
			name: feature.properties.name,
			mesh: mesh
		}
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
	{type: 'json', args: ['data/judete.topojson'], key: 'judete'},
	{type: 'json', args: ['data/judete-id.json'], key: 'id_judete'},
	{type: 'csv', args: ['data/recensaminte.csv', cleanCensusRow], key: 'recensaminte'}
];

function cleanCensusRow(row) {
	Object.keys(row).forEach(function(key) {
		if (key !== 'name') {
			row[key] = parseInt(row[key], 10);

			if (row[key] > max_population) {
				max_population = row[key];
			}
		}
	});

	return row;
}

loadData(dataSources, function(results) {
	results.recensaminte.forEach(function(row) {
		var countyCode = results.id_judete[row.name];
		censusData[countyCode] = row;
	});

	getExtrusion = d3.scale.linear().domain([0, max_population]).range([0, MAX_EXTRUSION]);

	var judete = results.judete;

	var features = topojson.feature(judete, judete.objects.ro_judete).features;

	renderTopography(features);
});

window.onbeforeunload = saveCameraOrientation;
