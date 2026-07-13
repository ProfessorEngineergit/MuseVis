import Darwin
import Foundation
import Metal

struct Schedule: Decodable {
    let fps: Float
    let duration: Float
    let frameCount: Int
    let featureStride: Int
    let boundaries: [Int]
    let modes: [UInt32]
}

struct Uniforms {
    var time: Float
    var rms: Float
    var bass: Float
    var mid: Float
    var high: Float
    var onset: Float
    var beat: Float
    var impact: Float
    var energy: Float
    var width: UInt32
    var height: UInt32
    var mode: UInt32
    var nextMode: UInt32
    var transition: Float
    var sceneProgress: Float
    var seed: Float
    var padding: Float = 0
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("MuseVis renderer: \(message)\n".utf8))
    exit(1)
}

func log(_ message: String) {
    FileHandle.standardError.write(Data("\(message)\n".utf8))
}

func writeAll(_ pointer: UnsafeRawPointer, count: Int) {
    var remaining = count
    var cursor = pointer
    while remaining > 0 {
        let written = Darwin.write(STDOUT_FILENO, cursor, remaining)
        if written <= 0 { fail("raw-video pipe closed") }
        remaining -= written
        cursor = cursor.advanced(by: written)
    }
}

guard CommandLine.arguments.count >= 7 else {
    fail("usage: renderer <features.f32> <schedule.json> <Visuals.metal> <width> <height> <max-frames|0> [start-frame]")
}

let featureURL = URL(fileURLWithPath: CommandLine.arguments[1])
let scheduleURL = URL(fileURLWithPath: CommandLine.arguments[2])
let shaderURL = URL(fileURLWithPath: CommandLine.arguments[3])
guard let width = UInt32(CommandLine.arguments[4]),
      let height = UInt32(CommandLine.arguments[5]),
      let requestedFrames = Int(CommandLine.arguments[6]) else {
    fail("invalid width, height or frame limit")
}
let startFrame = CommandLine.arguments.count >= 8 ? (Int(CommandLine.arguments[7]) ?? 0) : 0

let decoder = JSONDecoder()
guard let scheduleData = try? Data(contentsOf: scheduleURL),
      let schedule = try? decoder.decode(Schedule.self, from: scheduleData) else {
    fail("could not read schedule")
}
guard let featureData = try? Data(contentsOf: featureURL) else {
    fail("could not read audio features")
}
let features: [Float] = featureData.withUnsafeBytes { rawBuffer in
    Array(rawBuffer.bindMemory(to: Float.self))
}
guard features.count >= schedule.frameCount * schedule.featureStride else {
    fail("feature data is shorter than schedule")
}
guard schedule.modes.count + 1 == schedule.boundaries.count else {
    fail("invalid scene schedule")
}
guard let shaderSource = try? String(contentsOf: shaderURL, encoding: .utf8) else {
    fail("could not read Metal shader")
}

guard let device = MTLCreateSystemDefaultDevice() else { fail("Metal is unavailable") }
let options = MTLCompileOptions()
options.fastMathEnabled = true
let library: MTLLibrary
do {
    library = try device.makeLibrary(source: shaderSource, options: options)
} catch {
    fail("shader compilation failed: \(error)")
}
guard let function = library.makeFunction(name: "visualize") else { fail("visualize kernel missing") }
let pipeline: MTLComputePipelineState
do {
    pipeline = try device.makeComputePipelineState(function: function)
} catch {
    fail("pipeline creation failed: \(error)")
}
guard let queue = device.makeCommandQueue() else { fail("could not create Metal command queue") }

let bytesPerFrame = Int(width * height * 4)
guard let output = device.makeBuffer(length: bytesPerFrame, options: .storageModeShared),
      let uniformBuffer = device.makeBuffer(length: MemoryLayout<Uniforms>.stride, options: .storageModeShared) else {
    fail("could not allocate renderer buffers")
}

let grid = MTLSize(width: Int(width), height: Int(height), depth: 1)
let threadWidth = pipeline.threadExecutionWidth
let threadHeight = max(1, min(16, pipeline.maxTotalThreadsPerThreadgroup / threadWidth))
let group = MTLSize(width: threadWidth, height: threadHeight, depth: 1)
let availableFrames = max(0, schedule.frameCount - startFrame)
let totalFrames = requestedFrames > 0 ? min(requestedFrames, availableFrames) : availableFrames
let started = Date()
var sceneIndex = max(0, schedule.boundaries.dropLast().lastIndex(where: { $0 <= startFrame }) ?? 0)

log("Metal device: \(device.name)")
log("Rendering \(totalFrames) frames at \(width)x\(height), \(schedule.fps) fps")

for localFrame in 0..<totalFrames {
    let frame = startFrame + localFrame
    while sceneIndex + 1 < schedule.modes.count && frame >= schedule.boundaries[sceneIndex + 1] {
        sceneIndex += 1
    }

    let featureOffset = frame * schedule.featureStride
    let sceneStart = schedule.boundaries[sceneIndex]
    let sceneEnd = schedule.boundaries[sceneIndex + 1]
    let sceneLength = max(1, sceneEnd - sceneStart)
    let progress = Float(frame - sceneStart) / Float(sceneLength)
    let transitionFrames = min(14, max(6, sceneLength / 8))
    let transition = max(0, min(1, Float(frame - (sceneEnd - transitionFrames)) / Float(transitionFrames)))
    let nextMode = sceneIndex + 1 < schedule.modes.count ? schedule.modes[sceneIndex + 1] : schedule.modes[sceneIndex]

    var uniforms = Uniforms(
        time: Float(frame) / schedule.fps,
        rms: features[featureOffset],
        bass: features[featureOffset + 1],
        mid: features[featureOffset + 2],
        high: features[featureOffset + 3],
        onset: features[featureOffset + 4],
        beat: features[featureOffset + 5],
        impact: features[featureOffset + 6],
        energy: features[featureOffset + 7],
        width: width,
        height: height,
        mode: schedule.modes[sceneIndex],
        nextMode: nextMode,
        transition: transition,
        sceneProgress: progress,
        seed: Float(sceneIndex) * 17.173 + 3.7
    )
    memcpy(uniformBuffer.contents(), &uniforms, MemoryLayout<Uniforms>.stride)

    guard let commandBuffer = queue.makeCommandBuffer(),
          let encoder = commandBuffer.makeComputeCommandEncoder() else {
        fail("could not begin frame \(frame)")
    }
    encoder.setComputePipelineState(pipeline)
    encoder.setBuffer(output, offset: 0, index: 0)
    encoder.setBuffer(uniformBuffer, offset: 0, index: 1)
    encoder.dispatchThreads(grid, threadsPerThreadgroup: group)
    encoder.endEncoding()
    commandBuffer.commit()
    commandBuffer.waitUntilCompleted()
    if commandBuffer.status == .error { fail("GPU failed at frame \(frame): \(String(describing: commandBuffer.error))") }

    writeAll(output.contents(), count: bytesPerFrame)

    if localFrame == 0 || (localFrame + 1) % 150 == 0 || localFrame + 1 == totalFrames {
        let elapsed = Date().timeIntervalSince(started)
        let rate = Double(localFrame + 1) / max(0.001, elapsed)
        let remaining = Double(totalFrames - localFrame - 1) / max(0.001, rate)
        log(String(format: "frame %4d/%d  %5.1f%%  %.1f fps  ETA %.0fs", localFrame + 1, totalFrames,
                   Double(localFrame + 1) / Double(totalFrames) * 100.0, rate, remaining))
    }
}
